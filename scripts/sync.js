const mongoose = require('mongoose')
const db = require('../lib/database')
const Block = require('../models/block')
const Address = require('../models/address')
const Richlist = require('../models/richlist')
const Stats = require('../models/stats')
const settings = require('../lib/settings')
const { promisify } = require('../lib/util')
const debug = require('debug')('explorer:sync')
const fs = require('fs')

const validDbs = [ 'index', 'market' ]
const validModes = [ 'update', 'reindex' ]

// displays usage and exits
function usage() {
  console.log('Usage: node scripts/sync.js [database] [mode]');
  console.log('');
  console.log('database: (required)');
  console.log('index [mode] Main index: coin info/stats, transactions & addresses');
  console.log('market       Market data: summaries, orderbooks, trade history & chartdata')
  console.log('');
  console.log('mode: (required for index database only)');
  console.log('update       Updates index from last sync to current block');
  console.log('reindex      Clears index then resyncs from genesis to current block');
  console.log('');
  console.log('notes:'); 
  console.log('* \'current block\' is the latest created block when script is executed.');
  console.log('* The market database only supports (& defaults to) reindex mode.');
  console.log('');
  process.exit(0);
}

/**
 * Parse arguments.
 * @param {Array} args Array of commandline arguments, should not not include node path or script path
 * @returns {Object} database to run on and mode to run in
 */
function parseArgs(args) {
  debug(`args::`, args)
  if (args.length < 1 || validDbs.indexOf(args[0]) < 0 || (args.length === 2 && validModes.indexOf(args[1]) < 0)) {
    usage()
  }
  // if we're running on markets, then the only valid mode is to 'update'.
  return { database: args[0], mode: args[0] === 'market' ? 'update' : args[1] }
}

/**
 * Creates lock file in tmp directory. Only needed for indexing right now.
 * @param {String} database name of database to create lock for
 * @returns {Promise} resolves when file is written
 */
function createLock(database) {
  if (database === 'index') {
    return promisify(fs.stat, './tmp').then(([ e, s ]) => {
      if (e && !s) {
        return promisify(fs.mkdir, './tmp').then(e => {
          if (e) return Promise.reject(e)
          return promisify(fs.appendFile, `./tmp/${database}.pid`, process.pid)
            .then(e => e ? Promise.reject(e) : Promise.resolve())
        })
      }
      return promisify(fs.appendFile, `./tmp/${database}.pid`, process.pid)
        .then(e => e ? Promise.reject(e) : Promise.resolve())
    })
  }
  return Promise.resolve()
}

/**
 * Release lock on database. Only needed for indexing right now.
 * @param {String} database name of database to remove lock of
 * @returns {Promise} resolves when file is removed 
 */
function removeLock(database) {
  if (database === 'index') {
    return promisify(fs.unlink, `./tmp/${database}.pid`)
      .then(e => e ? Promise.reject(e) : Promise.resolve())
  }
  return Promise.resolve()
}

/**
 * Checks the lock on database. Only needed for indexing right now.
 * @param {String} database name of database to check lock of
 * @returns {Promise} resolves when check completes 
 */
function isLocked(database) {
  if (database === 'index')
    return promisify(fs.stat, `./tmp/${database}.pid`)
      // this pertains to the special case documented with promisify (fs.stat calls the
      // callback with [null, Object] if found, and just Error if it doesn't)
      .then(es => es instanceof Array)
  return Promise.resolve()
}

/**
 * Exit the program.
 */
function exit(database) {
  removeLock(database)
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(err => {
      debug('Failed to remove lock or disconnect from mongoose cleanly.')
      process.exit(1)
    })
}

////////  MAIN ENTRYPOINT ////////

const { database, mode } = parseArgs(process.argv.slice(2))
async function main() {
  debug(`- database=${database}, mode=${mode}`)
  
  // watch for concurrent execution with lockfiles
  if (await isLocked(database)) {
    debug('Script already running.')
    process.exit()
  }
  await createLock(database).catch(e => {
    debug('Error: unable to create lock file.')
    process.exit(1)
  })
  
  debug('Script launched with pid: ' + process.pid)
  await db.connect(settings.dbsettings).catch(err => {
    return exit(database)
  })

  if (database === 'index') {
    // await db.syncStats(settings.coin)
    // const stats = await promisify(db.get_stats, settings.coin)
    await promisify(Stats.remove.bind(Stats), {})

    if (mode === 'reindex') {
      await promisify(Block.remove.bind(Block), {})
      await promisify(Address.remove.bind(Address), {})
      await promisify(Richlist.update.bind(Richlist), { coin: settings.coin }, { received: [], balance: [] })
      
      debug('[reindex]: all indices cleared')
    }

    // await db.updateDb(0, stats.blocks, settings.update_timeout)

    // await promisify(db.update_richlist, 'received')
    // await promisify(db.update_richlist, 'balance')

    debug(`[${mode}]: index complete (${stats.blocks})`)
    exit(database)
  } else {
    await settings.markets.enabled.reduce((complete, m, _, markets) => {
      return promisify(db.check_market, m).then(([m, exists]) => {
        complete++
        if (exists) {
          return promisify(db.update_markets_db, m).then(err => {
            if (err) debug(`${m}: ${err}`)
            else debug(`${m} market data updated successfully.`)
            if (complete === markets.length) exit()
            return complete
          })
        }
        debug(`Error: entry for ${m} does not exist in markets db.`)
        if (complete === markets.length) exit()
        return complete
      })
    }, 0)
  }
}

main().catch(err => {
  console.log(`An error occurred: ${err}`)
  exit(database)
})

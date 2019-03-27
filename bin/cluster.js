const debug = require('debug')('explorer')
const cluster = require('cluster')
const fs = require('fs')
const settings = require('../lib/settings')
const db = require('../lib/database')
const { prettyPrint, spawnCmd } = require('../lib/util')

if (cluster.isMaster) {
  fs.writeFile('./tmp/cluster.pid', process.pid, function (err) {
    if (err) {
      debug('Error: unable to create cluster.pid')
      process.exit(1)
    } else {
      debug('Starting cluster with pid: ' + process.pid)

      const updateIntervals = []

      // ensure workers exit cleanly
      process.on('SIGINT', () => {
        debug('Cluster shutting down...')
        for (let worker of Object.values(cluster.workers)) {
          worker.kill()
        }
        // exit the master process
        // updateIntervals.forEach(i => clearInterval(i))
        process.exit(0)
      })

      // ensure workers have a valid schema to serve before spawning them
      db.connect(settings.dbsettings).then(() =>
        db.setupSchema()
      ).then(() => {
        // set database update intervals
        // (we need to regularily purge time sensitive caches (i.e. coin stats))
        // spawnCmd('node', [ 'scripts/sync.js', 'index', settings.index.index_mode || 'update' ])
        // updateIntervals.push(setInterval(function () {
        //   spawnCmd('node', [ 'scripts/sync.js', 'index', 'update' ])
        // }, settings.sync_timeout))
        // updateIntervals.push(setInterval(function () {
        //   spawnCmd('node', [ 'scripts/sync.js', 'market' ])
        // }, settings.market_timeout))
        // updateIntervals.push(setInterval(function () {
        //   spawnCmd('node', [ 'scripts/peers.js' ])
        // }, settings.peer_timeout))

        // spawn a worker for each cpu core
        require('os').cpus().forEach(_ => {
          cluster.fork()
        })
      }).catch(err => {
        debug(`An error occured setting up cluster: ${prettyPrint(err)}`)
        debug('Aborting...')
        // updateIntervals.forEach(i => clearInterval(i))
        process.exit(1)
      })

      // Listen for dying workers
      cluster.on('exit', () => {
        cluster.fork()
      })
    }
  })
} else {
  require('./instance')
}

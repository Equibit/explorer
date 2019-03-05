const request = require('request'),
  debug = require('debug')('explorer:lib'),
  settings = require('./settings'),
  Address = require('../models/address'),
  Block = require('../models/block'),
  { promisify, requestp, deepEqual } = require('./util'),
  { api } = require('./api')

const base_url = 'http://127.0.0.1:' + settings.port + '/api/'

function coinbase_supply () {
  return requestp(base_url + 'gettxoutsetinfo').then(info => info.total_amount)
}

module.exports = {

  getRawRpc (method, params) {
    return api.callRawRpc(method, params)
  },

  convert_to_satoshi (amount, cb) {
    const ret = amount.toFixed(8) * 100000000
    return cb ? cb(ret) : ret
  },

  get_hashrate (cb) {
    if (!settings.index.show_hashrate) return cb('-')
    if (settings.nethash === 'netmhashps') {
      request({uri: base_url + 'getmininginfo', json: true}, function (error, response, body) { // returned in mhash
        const unit = body.netmhashps || ''
        if (body && body.netmhashps) {
          switch (settings.nethash_units) {
            case 'K':
              return cb([ unit, (body.netmhashps * 1000).toFixed(4) ])
            case 'G':
              return cb([ unit, (body.netmhashps / 1000).toFixed(4) ])
            case 'H':
              return cb([ unit, (body.netmhashps * 1000000).toFixed(4) ])
            case 'T':
              return cb([ unit, (body.netmhashps / 1000000).toFixed(4) ])
            case 'P':
              return cb([ unit, (body.netmhashps / 1000000000).toFixed(4) ])
            default:
              return cb([ unit, body.netmhashps.toFixed(4) ])
          }
        }
        return cb([ unit, '-' ])
      })
    } else {
      request({uri: base_url + 'getnetworkhashps', json: true}, function (error, response, body) {
        if (error || body === 'There was an error. Check your console.') {
          return cb([ '', '-' ])
        }
        let unit = settings.nethash_units || ''
        if (unit) {
          switch (unit) {
            case 'K':
              return cb([ unit, (body / 1000).toFixed(4) ])
            case 'M':
              return cb([ unit, (body / 1000000).toFixed(4) ])
            case 'G':
              return cb([ unit, (body / 1000000000).toFixed(4) ])
            case 'T':
              return cb([ unit, (body / 1000000000000).toFixed(4) ])
            case 'P':
              return cb([ unit, (body / 1000000000000000).toFixed(4) ])
            default:
              return cb([ unit, (body).toFixed(4) ])
          }
        }
        const units = [ '', 'K', 'M', 'G', 'T', 'P' ]
        for (let factor = 1, i = 0; i < units.length; factor *= 1000, i++) {
          if (body / factor < 1000) return cb([ units[i], (body / factor).toFixed(4) ])
        }
      })
    }
  },

  get_difficulty (cb) {
    request({ uri: base_url + 'getdifficulty', json: true }, function (error, response, body) {
      return cb(body)
    })
  },

  get_connectioncount (cb) {
    request({ uri: base_url + 'getconnectioncount', json: true }, function (error, response, body) {
      return cb(body)
    })
  },

  getBlockcount () {
    return requestp(base_url + 'getblockcount')
  },

  async getBlocks (searchParams, flds) {
    const params = (searchParams.length ? searchParams : [ searchParams ])
    const mode = params.find(param => /[a-z]/i.test(param)) !== undefined ? 'hash' : 'height'
    const blockheight = await module.exports.getBlockcount()
    return promisify(
      Block[params.length > 1 ? 'find' : 'findOne'].bind(Block),
      { [mode]: { $in: params } },
      flds || {  }
    ).then(([ err, blocks ]) => err || !blocks._doc
      ? null
      : blocks.length
        ? blocks.map(block => dbToRpcBlock(block._doc, blockheight, flds.fulltx === 0 ? null : Object.keys(flds)))
        : dbToRpcBlock(blocks._doc, blockheight, params)
    )
  },

  get_blockhash: function (height, cb) {
    var uri = base_url + 'getblockhash?height=' + height
    request({uri: uri, json: true}, function (error, response, body) {
      return cb(body)
    })
  },

  async getBlock (hash, cb) {
    const ret = requestp(`${base_url}getblock?hash=${hash}`)
    return cb ? cb(await ret) : ret
  },

  get_rawtransaction: function (hash, cb) {
    var uri = base_url + 'getrawtransaction?txid=' + hash + '&decrypt=1'
    request({uri: uri, json: true}, function (error, response, body) {
      return cb(body)
    })
  },

  // synchonous loop used to interate through an array,
  // avoid use unless absolutely neccessary
  syncLoop: function (iterations, process, exit) {
    var index = 0,
      done = false,
      shouldExit = false
    var loop = {
      next: function () {
        if (done) {
          if (shouldExit && exit) {
            exit() // Exit if we're done
          }
          return // Stop the loop if we're done
        }
          // If we're not finished
        if (index < iterations) {
          index++ // Increment our index
          if (index % 100 === 0) { // clear stack
            setTimeout(function () {
              process(loop) // Run our process, pass in the loop
            }, 1)
          } else {
            process(loop) // Run our process, pass in the loop
          }
          // Otherwise we're done
        } else {
          done = true // Make sure we say we're done
          if (exit) exit() // Call the callback on exit
        }
      },
      iteration: function () {
        return index - 1 // Return the loop number we're on
      },
      break: function (end) {
        done = true // End the loop
        shouldExit = end // Passing end as true means we still call the exit callback
      }
    }
    loop.next()
    return loop
  },

  balance_supply (cb) {
    Address.find({}, 'balance').where('balance').gt(0).exec((err, docs) =>
      cb(docs.reduce((total, doc) => total + doc.balance, 0))
    )
  },

  get_supply (cb) {
    if (settings.supply == 'HEAVY') {
      var uri = base_url + 'getsupply'
      request({uri: uri, json: true}, function (error, response, body) {
        return cb(body)
      })
    } else if (settings.supply == 'GETINFO') {
      var uri = base_url + 'getinfo'
      request({uri: uri, json: true}, function (error, response, body) {
        return cb(body.moneysupply)
      })
    } else if (settings.supply == 'BALANCES') {
      module.exports.balance_supply(function (supply) {
        return cb(supply / 100000000)
      })
    } else if (settings.supply == 'TXOUTSET') {
      var uri = base_url + 'gettxoutsetinfo'
      request({uri: uri, json: true}, function (error, response, body) {
        return cb(body.total_amount)
      })
    } else {
      return coinbase_supply()
    }
  },

  is_unique (array, object, cb) {
    const index = array.map(a => deepEqual(a.addresses, object)).indexOf(true)
    const ret = [index < 0, index < 0 ? null : index]
    return cb ? cb(...ret) : ret
  },

  calculate_total (vout, cb) {
    return cb(vout.reduce((total, v) => total + v.amount, 0))
  },

  prepare_vout (vout, txid, vin, cb) {
    const vouts = vout.reduce((acc, v, i) => {
      const scriptpk = v.scriptPubKey
      if (scriptpk.type !== 'nonstandard' && scriptpk.type !== 'nulldata') {
        if (module.exports.is_unique(acc, scriptpk.addresses[0])) {
          return acc.concat([ {
            addresses: [ scriptpk.addresses[0] ],
            amount: module.exports.convert_to_satoshi(parseFloat(v.value))
          } ])
        } else {
          acc[i].amount += module.exports.convert_to_satoshi(parseFloat(v.value))
          return acc
        }
      } else return acc
    }, [])
    const vins = vin
    if (vout[0].scriptPubKey.type === 'nonstandard' && vins.length && vouts.length && vins[0].addresses === vouts[0].addresses) {
      vouts[0].amount -= vins[0].amount
      vins.shift()
    }
    return cb(vouts, vins)
  },

  async prepare_vin (tx, cb) {
    const ret = Promise.all(tx.vin.filter(vin => !vin.coinbase).map(vin =>
      promisify(this.get_rawtransaction, vin.txid).then(tx => tx && tx.vout
        ? tx.vout
          .filter(vout => vout.n === vin.vout && vout.scriptPubKey.addresses)
          .map(vout => ({ addresses: vout.scriptPubKey.addresses.join('\n'), amount: vout.value * 1e8 }))[0]
        : []
      )
    )).then(vins => vins.reduce((acc, vin) => {
      const [ unique, index ] = this.is_unique(acc, vin.addresses)
      if (unique) acc.push(vin)
      else acc[index].amount += vin.amount
      return acc
    }, [])).then(vins => {
      if (tx.vin.find(vin => vin.coinbase)) {
        vins.push({
          addresses: 'coinbase',
          amount: tx.vout.reduce((acc, vout) => acc + vout.value * 1e8, 0) - vins.reduce((acc, vin) => acc + vin.amout, 0)
        })
      }
      return vins
    }).catch(err => {
      debug(err)
      return []
    })
    return cb ? cb(await ret) : ret
  }

}

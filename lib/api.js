const express = require('express')
const debug = require('debug')('explorer:api')
const Client = require('bitcoin-core')
const settings = require('./settings')

const SpecTypes = Object.freeze({ 'ALL': 0, 'ONLY': 1, 'EXCEPT': 2 })
const CacheTypes = Object.freeze({ 'FORCE': 0, 'NEVER': 1, 'AS_NEEDED': 2 })

class Api {

  constructor ({
    rpcConfig = {
      type: SpecTypes.ALL,
      cacheDefault: CacheTypes.FORCE,
      allowRaw: false,
      rpc: []
    },
    cachers,
    wallet = {}
  }) {
    this.app = express()
    this.rpcConfig = rpcConfig
    this.cachers = cachers
    this.setWalletDetails(wallet)

    this.app.get('*', this.hasAccess.bind(this), (req, res) => {
      const method = req.path.substr(1)
      if (Api.requiresCredentials.includes(method) && !this.client.password) {
        return res.send('A wallet password is required and has not been set.')
      }
      const parameters = (req.query instanceof Array ? req.query : Object.values(req.query)).map(param => isNaN(param) ? param : parseFloat(param))

      switch (this.getCacheType(method)) {
        case CacheTypes.FORCE:
          return this.cachers.hasOwnProperty(method)
            ? this.cachers[method](...parameters).then(this.handle).then(r => res.send(r))
            : res.send(`No caching method was supplied for ${method}.`)
        case CacheTypes.NEVER:
          return this.rawRpc(method, parameters).then(r => res.send(r))
        case CacheTypes.AS_NEEDED:
          if (!this.cachers.hasOwnProperty(method))
            return this.rawRpc(method, parameters).then(r => res.send(r))
          return this.cachers[method](...parameters)
            .then(this.handle)
            .then(resp => resp === 'There was an error.'
              ? this.rawRpc(method, parameters)
              : resp
            ).then(r => res.send(r))
      }
    })
  }

  async rawRpc (method, parameters) {
    return this.client.command([ { method, parameters } ])
      .then(([ resp, err ]) => this.handle(resp, err))
  }

  async callRawRpc (method, parameters) {
    return this.rpcConfig.allowRaw ? this.rawRpc(method, parameters) : 'Direct RPC calls are not enabled.'
  }

  getCacheType (method) {
    if (this.rpcConfig.type === SpecTypes.ONLY) {
      return Object.values(CacheTypes).includes(this.rpcConfig.rpc[method])
        ? this.rpcConfig.rpc[method]
        : this.rpcConfig.cacheDefault
    }
    return this.rpcConfig.cacheDefault
  }

  handle (data, err) {
    if (err || data instanceof Error) {
      console.log(err)
      return 'There was an error.'
    }
    // if its an object just send it as is, otherwise cast to string
    return (data instanceof Object) ? data : (''+data)
  }

  hasAccess (req, res, next) {
    if (this.rpcConfig.type === SpecTypes.ALL) return next()
    
    const method = req.path.substr(1)
    if (
      (this.rpcConfig.type === SpecTypes.ONLY && this.rpcConfig.rpc.includes(method))
      || (this.rpcConfig.type === SpecTypes.EXCEPT && !this.rpcConfig.rpc.includes(method))
    ) {
      return next()
    } else {
      res.end('This method is restricted')
    }
  }

  setWalletDetails (details) {
    this.walletDetails = details
    this.client = new Client(details)
  }

  setCachers (cachers) {
    this.cachers = cachers
  }

  static get requiresCredentials () {
    return [
      'dumpprivkey',
      'importprivkey',
      'keypoolrefill',
      'sendfrom',
      'sendmany',
      'sendtoaddress',
      'signmessage',
      'signrawtransaction'
    ]
  }

}

function api () {
  return new Api({
    rpcConfig: {
      type: SpecTypes.ONLY,
      cacheDefault: CacheTypes.NEVER,
      allowRaw: true,
      rpc: [
        'getnetworkhashps',
        'getmininginfo',
        'getdifficulty',
        'getconnectioncount',
        'getblockcount',
        'getblockhash',
        'getblock',
        'getrawtransaction',
        'getpeerinfo',
        'gettxoutsetinfo',
        'getmempoolinfo',
        'getrawmempool'
      ]
    },
    wallet: settings.wallet
  })
}

module.exports = {
  api: api(),
  SpecTypes,
  CacheTypes
}

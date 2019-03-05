const express = require('express'),
  debug = require('debug')('explorer'),
  path = require('path'),
  { api } = require('./lib/api'),
  favicon = require('static-favicon'),
  logger = require('morgan'),
  cookieParser = require('cookie-parser'),
  bodyParser = require('body-parser'),
  settings = require('./lib/settings'),
  routes = require('./routes/index'),
  lib = require('./lib/explorer'),
  db = require('./lib/database'),
  locale = require('./lib/locale'),
  { requestp } = require('./lib/util'),
  info = require('./info')

const app = express()
info(app)
api.setCachers(db.rpc)

  // view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(favicon(path.join(__dirname, settings.favicon)));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// routes
app.use('/api', api.app);
app.use('/', routes);
app.use('/ext/getmoneysupply', function(req,res){
  lib.get_supply(function(supply){
    res.send(' '+supply);
  });
});

app.use('/ext/getaddress/:hash', function(req,res){
  db.get_address(req.param('hash'), function(address){
    if (address) {
      var a_ext = {
        address: address.a_id,
        sent: (address.sent / 100000000),
        received: (address.received / 100000000),
        balance: (address.balance / 100000000).toString().replace(/(^-+)/mg, ''),
        last_txs: address.txs,
      };
      res.send(a_ext);
    } else {
      res.send({ error: 'address not found.', hash: req.param('hash')})
    }
  });
});

app.use('/ext/getbalance/:hash', function(req,res){
  db.get_address(req.param('hash'), function(address){
    if (address) {
      res.send((address.balance / 100000000).toString().replace(/(^-+)/mg, ''));
    } else {
      res.send({ error: 'address not found.', hash: req.param('hash')})
    }
  });
});

app.use('/ext/getdistribution', function(req,res){
  db.get_richlist(settings.coin, function(richlist){
    db.get_stats(settings.coin, function(stats){
      db.get_distribution(richlist, stats, function(dist){
        res.send(dist);
      });
    });
  });
});

app.use('/ext/getblocks/:start/:end', async function (req, res) {
  const endpoint = settings.endpoint || `http://${req.headers.host}`
  const start = parseInt(req.param('start'))
  const end = parseInt(req.param('end'))
  const reverse = req.query.reverse && req.query.reverse.toLowerCase() === 'true'
  const flds = typeof req.query.flds === 'string' ? req.query.flds.split(',') : req.query.flds || []

  if (start > end) {
    res.send({ error: `End blockheight must be greater than or equal to the start blockheight.` })
    return
  }

  const blockcount = await requestp(`${endpoint}/api/getblockcount`)
  let heights = Array(end - start + 1).fill(undefined).map((_, i) => start + i)
  if (reverse) heights = heights.map(h => blockcount - h + 1)

  const searchFlds = flds[0] === 'summary'
    ? { fulltx: 0, _id: 0 }
    : flds ? flds.reduce((acc, fld) => ({ ...acc, [fld]: 1 }), { _id: 0, height: 1 }) : []
  let blocks = await lib.getBlocks(heights, searchFlds)
  if (!blocks) {
    blocks = await Promise.all(heights.map(h => lib.getRawRpc('getblockhash', [ h ]).then(hash => lib.getRawRpc('getblock', [ hash ]))))
  } else {
    blocks = blocks.sort((a, b) => (reverse ? -1 : 1) * (a.height <= b.height ? -1 : 1))
  }
  blocks.forEach(block => {
    if (!flds.includes('height') && flds[0] !== 'summary') delete block['height']
  })
  res.send({ data: { blockcount, blocks } })
})

app.use('/ext/connections', function(req,res){
  db.get_peers(function(peers){
    res.send({data: peers});
  });
});

// locals
app.set('title', settings.title);
app.set('symbol', settings.symbol);
app.set('coin', settings.coin);
app.set('locale', locale);
app.set('display', settings.display);
app.set('markets', settings.markets);
app.set('twitter', settings.twitter);
app.set('facebook', settings.facebook);
app.set('googleplus', settings.googleplus);
app.set('youtube', settings.youtube);
app.set('genesis_block', settings.genesis_block);
app.set('index', settings.index);
app.set('txcount', settings.txcount);
app.set('nethash', settings.nethash);
app.set('nethash_units', settings.nethash_units);
app.set('show_sent_received', settings.show_sent_received);
app.set('logo', settings.logo);
app.set('theme', settings.theme);
app.set('labels', settings.labels);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});

module.exports = app;

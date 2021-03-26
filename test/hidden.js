var tape = require('tape')
var create = require('./helpers/create')
const errors = require('../lib/errors')

tape('hidden file', function (t) {
  t.plan(6)
  var drive = create()
  drive.writeFile('/foo', 'bar', { db: { hidden: true }}, function (err) {
    t.error(err, 'no error')

    drive.readdir('/', function (err, dir) {
      t.error(err, 'no error')
      t.same(dir, [])
    })

    // file is not visible without hidden flag
    drive.readFile('/foo', function (err) {
      t.true(err instanceof errors.FileNotFound)
    })
    
    drive.readFile('/foo', { db: { hidden: true }, encoding: 'utf-8' }, function (err, data) {
      t.error(err, 'no error')
      t.same(data, 'bar')
    })
  })
})

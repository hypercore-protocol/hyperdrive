const tape = require('tape')
const create = require('./helpers/create')

tape('Should copy content of file', t => {
    var drive = create()

    drive.writeFile('hello', 'foo', err => {
        t.error(err, 'no error')
        drive.copy('hello', 'world', err => {
            t.error(err, 'no error')

            drive.readdir('/', (err, entries) => {
                t.error(err, 'no error')
                t.same(entries.sort(), ['hello', 'world'].sort())

                drive.readFile('hello', { encoding: 'utf8' }, (err, contents) => {
                    t.error(err, 'no error')
                    t.same(contents, 'foo')

                    drive.readFile('world', { encoding: 'utf8' }, (err, contents) => {
                        t.error(err, 'no error')
                        t.same(contents, 'foo')

                        t.end()
                    })
                })
            })
        })
    })
})

tape('Should copy content of file overwriting an existing one', t => {
    var drive = create()

    drive.writeFile('hello', 'foo', err => {
        t.error(err, 'no error')
        drive.writeFile('world', 'bar', err => {
            t.error(err, 'no error')

            drive.copy('hello', 'world', err => {
                t.error(err, 'no error')

                drive.readdir('/', (err, entries) => {
                    t.error(err, 'no error')
                    t.same(entries.sort(), ['hello', 'world'].sort())

                    drive.readFile('hello', { encoding: 'utf8' }, (err, contents) => {
                        t.error(err, 'no error')
                        t.same(contents, 'foo')

                        drive.readFile('world', { encoding: 'utf8' }, (err, contents) => {
                            t.error(err, 'no error')
                            t.same(contents, 'foo')

                            t.end()
                        })
                    })
                })
            })
        })
    })
})

tape('Should copy content of directory', t => {
    var drive = create()
    drive.mkdir('hello', err => {
        t.error(err, 'no error')
        drive.writeFile('hello/this', 'foo', err => {
            t.error(err, 'no error')
            drive.copy('hello', 'world', err => {
                t.error(err, 'got error')

                drive.readdir('/', (err, entries) => {
                    t.error(err, 'no error')
                    t.same(entries.sort(), ['hello', 'world'].sort())

                    drive.readdir('world', (err, entries) => {
                        t.error(err, 'no error')
                        t.same(entries, ['this'])

                        drive.readFile('world/this', { encoding: 'utf8' }, (err, contents) => {
                            t.error(err, 'no error')
                            t.same(contents, 'foo')

                            t.end()
                        })
                    })
                })
            })
        })
    })
})

tape('Should overwrite content of existing destination directory', t => {
    var drive = create()
    drive.mkdir('hello', err => {
        t.error(err, 'no error')
        drive.mkdir('world', err => {
            t.error(err, 'no error')

            drive.writeFile('hello/this', 'foo', err => {
                t.error(err, 'no error')
                drive.writeFile('world/this', 'bar', err => {
                    t.error(err, 'no error')
                    drive.writeFile('world/is', 'baz', err => {
                        t.error(err, 'no error')

                        drive.copy('hello', 'world', err => {
                            t.error(err, 'got error')

                            drive.readdir('/', (err, entries) => {
                                t.error(err, 'no error')
                                t.same(entries.sort(), ['hello', 'world'].sort())

                                drive.readdir('world', (err, entries) => {
                                    t.error(err, 'no error')
                                    t.same(entries, ['this'])

                                    drive.readFile('world/this', { encoding: 'utf8' }, (err, contents) => {
                                        t.error(err, 'no error')
                                        t.same(contents, 'foo')

                                        t.end()
                                    })
                                })
                            })
                        })
                    })
                })
            })
        })
    })
})

tape('Should error if source does not exist', t => {
    var drive = create()
    drive.copy('hello', 'world', err => {
        t.ok(err, 'got error')
        t.end()
    })
})

tape('Should error when destination and source point to the same file', t => {
    var drive = create()

    drive.writeFile('hello', 'foo', err => {
        t.error(err, 'no error')
        drive.copy('hello', 'hello', err => {
            t.ok(err, 'got error')
            t.end()
        })
    })

})

tape('Should error if source does not exist', t => {
    var drive = create()
    drive.copy('hello', 'world', err => {
        t.ok(err, 'got error')
        t.end()
    })
})


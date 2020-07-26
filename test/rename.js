const tape = require('tape')
const create = require('./helpers/create')

tape('rename shall change the name of a file', t => {
    var drive = create()
    drive.writeFile('/hello', '', err => {
        t.error(err, 'no error')
        drive.rename('/hello', '/world', err => {
            t.error(err, 'no error')
            drive.readdir('/', (err, entries) => {
                t.error(err, 'no error')
                t.same(entries, ['world'])
                t.end()
            })
        })
    })
})

tape('rename shall change the name of a file within a directory', t => {
    var drive = create()
    drive.mkdir('/foo', err => {
        t.error(err, 'no error')
        drive.writeFile('/foo/hello', '', err => {
            t.error(err, 'no error')
            drive.rename('/foo/hello', '/foo/world', err => {
                t.error(err, 'no error')
                drive.readdir('/foo', (err, entries) => {
                    t.error(err, 'no error')
                    t.same(entries, ['world'])
                    t.end()
                })
            })
        })
    })
})

tape.skip('rename shall change the name of a directory', t => {
    /* This test is skipped because rename is currently not able to rename a directory */
    /* Thuis also check that files are not deleted or altered*/
    var drive = create()
    drive.mkdir('/hello', err => {
        t.error(err, 'no error')
        drive.writeFile('/hello/foo', 'bar', err => {
            t.error(err, 'no error')
            drive.rename('hello', 'world', err => {
                t.error(err, 'no error')
                drive.readdir('/', (err, entries) => {
                    t.error(err, 'no error')
                    t.same(entries, ['world'])
                    drive.readdir('/world', (err, entries) => {
                        t.error(err, 'no error')
                        t.same(entries, ['foo'])
                        drive.readFile('/world/foo', { encoding: 'utf8' }, (err, contents) => {
                            t.error(err, 'no error')
                            t.same(contents, 'bar')
                            drive.readFile('/world/bar', { encoding: 'utf8' }, (err, contents) => {
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

tape('rename can move a file', t => {
    var drive = create()
    drive.mkdir('/foo', err => {
        t.error(err, 'no error')
        drive.writeFile('/foo/hello', '', err => {
            t.error(err, 'no error')
            drive.rename('/foo/hello', '/hello', err => {
                t.error(err, 'no error')
                drive.readdir('/foo', (err, entries) => {
                    t.error(err, 'no error')
                    t.same(entries, [])
                    drive.readdir('/', (err, entries) => {
                        t.error(err, 'no error')
                        t.same(entries.sort(), ['foo', 'hello'].sort())
                        t.end()
                    })
                })
            })
        })
    })
})

tape.skip('if old names a symbolic link, rename shall operate on the symbolic link itself', t => {
    var drive = create()
    drive.writeFile('hello', 'foo', err => {
        t.error(err, 'no error')
        drive.writeFile('world', 'bar', err => {
            t.error(err, 'no error')
            drive.symlink('hello', 'hello_link', err => {
                t.error(err, 'no error')
                drive.rename('hello_link', 'world', err => {
                    t.error(err, 'no error')
                    drive.readdir('/', (err, entries) => {
                        t.error(err, 'no error')
                        t.same(entries.sort(), ['hello', 'world'].sort())
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

tape.skip('if new names a symbolic link, rename shall operate on the symbolic link itself', t => {
    var drive = create()
    drive.writeFile('hello', 'foo', err => {
        t.error(err, 'no error')
        drive.writeFile('world', 'bar', err => {
            t.error(err, 'no error')
            drive.symlink('hello', 'hello_link', err => {
                t.error(err, 'no error')
                drive.rename('world', 'hello_link', err => {
                    t.error(err, 'no error')
                    drive.readdir('/', (err, entries) => {
                        t.error(err, 'no error')
                        t.same(entries.sort(), ['hello', 'hello_link'].sort())
                        drive.readFile('hello_link', { encoding: 'utf8' }, (err, contents) => {
                            t.error(err, 'no error')
                            t.same(contents, 'bar')
                            t.end()
                        })
                    })
                })
            })
        })
    })
})

tape.skip('if old and new resolve to the same existing file, rename shall return successfully and perform no other action', t => {
    var drive = create()
    drive.writeFile('hello', 'foo', err => {
        t.error(err, 'no error')
        drive.rename('hello', '/hello', err => {
            t.error(err, 'no error')
            drive.readdir('/', (err, entries) => {
                t.error(err, 'no error')
                t.same(entries, ['hello'])
                drive.readFile('hello', { encoding: 'utf8' }, (err, contents) => {
                    t.error(err, 'no error')
                    t.same(contents, 'foo')
                    t.end()
                })
            })
        })
    })
})

tape('if the link named by the newpath argument exists, it shall be removed and oldpath renamed to newpath', t => {
    var drive = create()
    drive.writeFile('hello', 'foo', err => {
        t.error(err, 'no error')
        drive.writeFile('world', 'bar', err => {
            t.error(err, 'no error')
            drive.rename('hello', 'world', err => {
                t.error(err, 'no error')
                drive.readdir('/', (err, entries) => {
                    t.error(err, 'no error')
                    t.same(entries, ['world'])
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

tape('if the old argument points to the pathname of a file that is not a directory, the new argument shall not point to the pathname of a directory', t => {
    var drive = create()
    drive.writeFile('hello', '', err => {
        t.error(err, 'no error')
        drive.mkdir('/world', err => {
            t.error(err, 'no error')
            drive.rename('hello', 'world', err => {
                t.ok(err, 'got error')
                t.end()
            })
        })
    })
})

tape.skip('if old points to the pathname of a directory, new shall not point to the pathname of a file that is not a directory', t => {
    /* This test is skipped because rename is currently not able to rename a directory */
    var drive = create()
    drive.mkdir('/foo', err => {
        t.error(err, 'no error')
        drive.writeFile('hello', '', err => {
            t.error(err, 'no error')
            drive.rename('foo', 'hello', err => {
                t.ok(err, 'got error')
                t.end()
            })
        })
    })
})

tape.skip('if new names an existing directory, it shall be required to be an empty directory', t => {
    /* This test is skipped because rename is currently not able to rename a directory */
    var drive = create()
    drive.mkdir('/hello', err => {
        t.error(err, 'no error')
        drive.mkdir('/world', err => {
            t.error(err, 'no error')
            drive.writeFile('/world/foo', '', err => {
                t.error(err, 'no error')
                drive.rename('hello', 'world', err => {
                    t.ok(err, 'got error')
                    t.end()
                })
            })
        })
    })
})

tape.skip('the new pathname shall not contain a path prefix that names old', t => {
    var drive = create()
    drive.mkdir('/hello', err => {
        t.error(err, 'no error')
        drive.mkdir('/hello/world', err => {
            t.error(err, 'no error')
            drive.rename('/hello/world', '/hello', err => {
                t.ok(err, 'got error')
                t.end()
            })
        })
    })
})

tape.skip('if the directory named by the new argument exists, it shall be removed and old renamed to new.', t => {
    var drive = create()
    drive.mkdir('/hello', err => {
        t.error(err, 'no error')
        drive.writeFile('/hello/foo', 'bar', err => {
            t.error(err, 'no error')
            drive.writeFile('/hello/bar', 'foo', err => {
                t.error(err, 'no error')
                drive.mkdir('/world', err => {
                    t.error(err, 'no error')
                    drive.rename('hello', 'world', err => {
                        t.error(err, 'no error')
                        drive.readdir('/', (err, entries) => {
                            t.error(err, 'no error')
                            t.same(entries, ['world'])
                            drive.readdir('/world', (err, entries) => {
                                t.error(err, 'no error')
                                t.same(entries.sort(), ['foo', 'bar'].sort())
                                drive.readFile('hello/foo', { encoding: 'utf8' }, (err, contents) => {
                                    t.error(err, 'no error')
                                    t.same(contents, 'bar')
                                    drive.readFile('hello/bar', { encoding: 'utf8' }, (err, contents) => {
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

tape('can not rename a directory', t => { //TODO: remove once directory renaming is supported
    var drive = create()
    drive.mkdir('/foo', err => {
        t.error(err, 'no error')
        drive.rename('/foo', '/bar', err => {
            t.ok(err, 'got error')
            t.end()
        })
    })
})

tape('can not rename a symlink', t => { //TODO: remove once symlink renaming is supported
    var drive = create()
    drive.symlink('hello', 'test', err => {
        t.error(err, 'no error')
        drive.rename('hello', 'world', err => {
            t.ok(err, 'got error')
            t.end()
        })
    })
})
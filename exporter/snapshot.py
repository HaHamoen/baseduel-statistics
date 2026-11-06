"""
A consistent copy of a live SQLite database, made with the backup API.

Never cp a database a bot has open: the copy can be half a file, and whatever
sits in the -wal is left behind. The backup API reads through the -wal and
gives one snapshot of the whole file, while the bot goes on writing.

The source is opened read-only. `immutable=True` is for a file nobody is
writing (a copy on the PC): SQLite then creates no -shm or -wal beside it,
which a read-only open of a WAL database otherwise may. On the VM, where the
bot has the database open, leave it False.
"""
import os
import sqlite3


def snapshot(src, dst, immutable=False):
    """Copy `src` into `dst` (replacing it) and check the copy. Returns dst."""
    if not os.path.exists(src):
        raise FileNotFoundError(src)
    uri = "file:%s?mode=ro%s" % (os.path.abspath(src),
                                 "&immutable=1" if immutable else "")
    tmp = dst + ".tmp"
    if os.path.exists(tmp):
        os.remove(tmp)
    source = sqlite3.connect(uri, uri=True)
    try:
        target = sqlite3.connect(tmp)
        try:
            source.backup(target)
            ok = target.execute("PRAGMA quick_check").fetchone()[0]
            # One file, no -wal beside it: the exporter opens it immutable.
            target.execute("PRAGMA journal_mode=DELETE")
        finally:
            target.close()
    finally:
        source.close()
    if ok != "ok":
        os.remove(tmp)
        raise RuntimeError("snapshot of %s failed its check: %s" % (src, ok))
    os.replace(tmp, dst)
    return dst


def open_snapshot(path):
    """A read-only connection to a snapshot, rows as sqlite3.Row."""
    conn = sqlite3.connect("file:%s?mode=ro&immutable=1"
                           % os.path.abspath(path), uri=True)
    conn.row_factory = sqlite3.Row
    return conn

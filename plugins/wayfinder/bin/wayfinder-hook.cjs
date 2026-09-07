#!/usr/bin/env node
"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// node_modules/graceful-fs/polyfills.js
var require_polyfills = __commonJS({
  "node_modules/graceful-fs/polyfills.js"(exports2, module2) {
    var constants = require("constants");
    var origCwd = process.cwd;
    var cwd = null;
    var platform = process.env.GRACEFUL_FS_PLATFORM || process.platform;
    process.cwd = function() {
      if (!cwd)
        cwd = origCwd.call(process);
      return cwd;
    };
    try {
      process.cwd();
    } catch (er) {
    }
    if (typeof process.chdir === "function") {
      chdir = process.chdir;
      process.chdir = function(d) {
        cwd = null;
        chdir.call(process, d);
      };
      if (Object.setPrototypeOf) Object.setPrototypeOf(process.chdir, chdir);
    }
    var chdir;
    module2.exports = patch;
    function patch(fs2) {
      if (constants.hasOwnProperty("O_SYMLINK") && process.version.match(/^v0\.6\.[0-2]|^v0\.5\./)) {
        patchLchmod(fs2);
      }
      if (!fs2.lutimes) {
        patchLutimes(fs2);
      }
      fs2.chown = chownFix(fs2.chown);
      fs2.fchown = chownFix(fs2.fchown);
      fs2.lchown = chownFix(fs2.lchown);
      fs2.chmod = chmodFix(fs2.chmod);
      fs2.fchmod = chmodFix(fs2.fchmod);
      fs2.lchmod = chmodFix(fs2.lchmod);
      fs2.chownSync = chownFixSync(fs2.chownSync);
      fs2.fchownSync = chownFixSync(fs2.fchownSync);
      fs2.lchownSync = chownFixSync(fs2.lchownSync);
      fs2.chmodSync = chmodFixSync(fs2.chmodSync);
      fs2.fchmodSync = chmodFixSync(fs2.fchmodSync);
      fs2.lchmodSync = chmodFixSync(fs2.lchmodSync);
      fs2.stat = statFix(fs2.stat);
      fs2.fstat = statFix(fs2.fstat);
      fs2.lstat = statFix(fs2.lstat);
      fs2.statSync = statFixSync(fs2.statSync);
      fs2.fstatSync = statFixSync(fs2.fstatSync);
      fs2.lstatSync = statFixSync(fs2.lstatSync);
      if (fs2.chmod && !fs2.lchmod) {
        fs2.lchmod = function(path2, mode, cb) {
          if (cb) process.nextTick(cb);
        };
        fs2.lchmodSync = function() {
        };
      }
      if (fs2.chown && !fs2.lchown) {
        fs2.lchown = function(path2, uid, gid, cb) {
          if (cb) process.nextTick(cb);
        };
        fs2.lchownSync = function() {
        };
      }
      if (platform === "win32") {
        fs2.rename = typeof fs2.rename !== "function" ? fs2.rename : (function(fs$rename) {
          function rename(from, to, cb) {
            var start = Date.now();
            var backoff = 0;
            fs$rename(from, to, function CB(er) {
              if (er && (er.code === "EACCES" || er.code === "EPERM" || er.code === "EBUSY") && Date.now() - start < 6e4) {
                setTimeout(function() {
                  fs2.stat(to, function(stater, st) {
                    if (stater && stater.code === "ENOENT")
                      fs$rename(from, to, CB);
                    else
                      cb(er);
                  });
                }, backoff);
                if (backoff < 100)
                  backoff += 10;
                return;
              }
              if (cb) cb(er);
            });
          }
          if (Object.setPrototypeOf) Object.setPrototypeOf(rename, fs$rename);
          return rename;
        })(fs2.rename);
      }
      fs2.read = typeof fs2.read !== "function" ? fs2.read : (function(fs$read) {
        function read(fd, buffer, offset, length, position, callback_) {
          var callback;
          if (callback_ && typeof callback_ === "function") {
            var eagCounter = 0;
            callback = function(er, _, __) {
              if (er && er.code === "EAGAIN" && eagCounter < 10) {
                eagCounter++;
                return fs$read.call(fs2, fd, buffer, offset, length, position, callback);
              }
              callback_.apply(this, arguments);
            };
          }
          return fs$read.call(fs2, fd, buffer, offset, length, position, callback);
        }
        if (Object.setPrototypeOf) Object.setPrototypeOf(read, fs$read);
        return read;
      })(fs2.read);
      fs2.readSync = typeof fs2.readSync !== "function" ? fs2.readSync : /* @__PURE__ */ (function(fs$readSync) {
        return function(fd, buffer, offset, length, position) {
          var eagCounter = 0;
          while (true) {
            try {
              return fs$readSync.call(fs2, fd, buffer, offset, length, position);
            } catch (er) {
              if (er.code === "EAGAIN" && eagCounter < 10) {
                eagCounter++;
                continue;
              }
              throw er;
            }
          }
        };
      })(fs2.readSync);
      function patchLchmod(fs3) {
        fs3.lchmod = function(path2, mode, callback) {
          fs3.open(
            path2,
            constants.O_WRONLY | constants.O_SYMLINK,
            mode,
            function(err, fd) {
              if (err) {
                if (callback) callback(err);
                return;
              }
              fs3.fchmod(fd, mode, function(err2) {
                fs3.close(fd, function(err22) {
                  if (callback) callback(err2 || err22);
                });
              });
            }
          );
        };
        fs3.lchmodSync = function(path2, mode) {
          var fd = fs3.openSync(path2, constants.O_WRONLY | constants.O_SYMLINK, mode);
          var threw = true;
          var ret;
          try {
            ret = fs3.fchmodSync(fd, mode);
            threw = false;
          } finally {
            if (threw) {
              try {
                fs3.closeSync(fd);
              } catch (er) {
              }
            } else {
              fs3.closeSync(fd);
            }
          }
          return ret;
        };
      }
      function patchLutimes(fs3) {
        if (constants.hasOwnProperty("O_SYMLINK") && fs3.futimes) {
          fs3.lutimes = function(path2, at, mt, cb) {
            fs3.open(path2, constants.O_SYMLINK, function(er, fd) {
              if (er) {
                if (cb) cb(er);
                return;
              }
              fs3.futimes(fd, at, mt, function(er2) {
                fs3.close(fd, function(er22) {
                  if (cb) cb(er2 || er22);
                });
              });
            });
          };
          fs3.lutimesSync = function(path2, at, mt) {
            var fd = fs3.openSync(path2, constants.O_SYMLINK);
            var ret;
            var threw = true;
            try {
              ret = fs3.futimesSync(fd, at, mt);
              threw = false;
            } finally {
              if (threw) {
                try {
                  fs3.closeSync(fd);
                } catch (er) {
                }
              } else {
                fs3.closeSync(fd);
              }
            }
            return ret;
          };
        } else if (fs3.futimes) {
          fs3.lutimes = function(_a, _b, _c, cb) {
            if (cb) process.nextTick(cb);
          };
          fs3.lutimesSync = function() {
          };
        }
      }
      function chmodFix(orig) {
        if (!orig) return orig;
        return function(target, mode, cb) {
          return orig.call(fs2, target, mode, function(er) {
            if (chownErOk(er)) er = null;
            if (cb) cb.apply(this, arguments);
          });
        };
      }
      function chmodFixSync(orig) {
        if (!orig) return orig;
        return function(target, mode) {
          try {
            return orig.call(fs2, target, mode);
          } catch (er) {
            if (!chownErOk(er)) throw er;
          }
        };
      }
      function chownFix(orig) {
        if (!orig) return orig;
        return function(target, uid, gid, cb) {
          return orig.call(fs2, target, uid, gid, function(er) {
            if (chownErOk(er)) er = null;
            if (cb) cb.apply(this, arguments);
          });
        };
      }
      function chownFixSync(orig) {
        if (!orig) return orig;
        return function(target, uid, gid) {
          try {
            return orig.call(fs2, target, uid, gid);
          } catch (er) {
            if (!chownErOk(er)) throw er;
          }
        };
      }
      function statFix(orig) {
        if (!orig) return orig;
        return function(target, options, cb) {
          if (typeof options === "function") {
            cb = options;
            options = null;
          }
          function callback(er, stats) {
            if (stats) {
              if (stats.uid < 0) stats.uid += 4294967296;
              if (stats.gid < 0) stats.gid += 4294967296;
            }
            if (cb) cb.apply(this, arguments);
          }
          return options ? orig.call(fs2, target, options, callback) : orig.call(fs2, target, callback);
        };
      }
      function statFixSync(orig) {
        if (!orig) return orig;
        return function(target, options) {
          var stats = options ? orig.call(fs2, target, options) : orig.call(fs2, target);
          if (stats) {
            if (stats.uid < 0) stats.uid += 4294967296;
            if (stats.gid < 0) stats.gid += 4294967296;
          }
          return stats;
        };
      }
      function chownErOk(er) {
        if (!er)
          return true;
        if (er.code === "ENOSYS")
          return true;
        var nonroot = !process.getuid || process.getuid() !== 0;
        if (nonroot) {
          if (er.code === "EINVAL" || er.code === "EPERM")
            return true;
        }
        return false;
      }
    }
  }
});

// node_modules/graceful-fs/legacy-streams.js
var require_legacy_streams = __commonJS({
  "node_modules/graceful-fs/legacy-streams.js"(exports2, module2) {
    var Stream = require("stream").Stream;
    module2.exports = legacy;
    function legacy(fs2) {
      return {
        ReadStream,
        WriteStream
      };
      function ReadStream(path2, options) {
        if (!(this instanceof ReadStream)) return new ReadStream(path2, options);
        Stream.call(this);
        var self = this;
        this.path = path2;
        this.fd = null;
        this.readable = true;
        this.paused = false;
        this.flags = "r";
        this.mode = 438;
        this.bufferSize = 64 * 1024;
        options = options || {};
        var keys = Object.keys(options);
        for (var index = 0, length = keys.length; index < length; index++) {
          var key = keys[index];
          this[key] = options[key];
        }
        if (this.encoding) this.setEncoding(this.encoding);
        if (this.start !== void 0) {
          if ("number" !== typeof this.start) {
            throw TypeError("start must be a Number");
          }
          if (this.end === void 0) {
            this.end = Infinity;
          } else if ("number" !== typeof this.end) {
            throw TypeError("end must be a Number");
          }
          if (this.start > this.end) {
            throw new Error("start must be <= end");
          }
          this.pos = this.start;
        }
        if (this.fd !== null) {
          process.nextTick(function() {
            self._read();
          });
          return;
        }
        fs2.open(this.path, this.flags, this.mode, function(err, fd) {
          if (err) {
            self.emit("error", err);
            self.readable = false;
            return;
          }
          self.fd = fd;
          self.emit("open", fd);
          self._read();
        });
      }
      function WriteStream(path2, options) {
        if (!(this instanceof WriteStream)) return new WriteStream(path2, options);
        Stream.call(this);
        this.path = path2;
        this.fd = null;
        this.writable = true;
        this.flags = "w";
        this.encoding = "binary";
        this.mode = 438;
        this.bytesWritten = 0;
        options = options || {};
        var keys = Object.keys(options);
        for (var index = 0, length = keys.length; index < length; index++) {
          var key = keys[index];
          this[key] = options[key];
        }
        if (this.start !== void 0) {
          if ("number" !== typeof this.start) {
            throw TypeError("start must be a Number");
          }
          if (this.start < 0) {
            throw new Error("start must be >= zero");
          }
          this.pos = this.start;
        }
        this.busy = false;
        this._queue = [];
        if (this.fd === null) {
          this._open = fs2.open;
          this._queue.push([this._open, this.path, this.flags, this.mode, void 0]);
          this.flush();
        }
      }
    }
  }
});

// node_modules/graceful-fs/clone.js
var require_clone = __commonJS({
  "node_modules/graceful-fs/clone.js"(exports2, module2) {
    "use strict";
    module2.exports = clone;
    var getPrototypeOf = Object.getPrototypeOf || function(obj) {
      return obj.__proto__;
    };
    function clone(obj) {
      if (obj === null || typeof obj !== "object")
        return obj;
      if (obj instanceof Object)
        var copy = { __proto__: getPrototypeOf(obj) };
      else
        var copy = /* @__PURE__ */ Object.create(null);
      Object.getOwnPropertyNames(obj).forEach(function(key) {
        Object.defineProperty(copy, key, Object.getOwnPropertyDescriptor(obj, key));
      });
      return copy;
    }
  }
});

// node_modules/graceful-fs/graceful-fs.js
var require_graceful_fs = __commonJS({
  "node_modules/graceful-fs/graceful-fs.js"(exports2, module2) {
    var fs2 = require("fs");
    var polyfills = require_polyfills();
    var legacy = require_legacy_streams();
    var clone = require_clone();
    var util = require("util");
    var gracefulQueue;
    var previousSymbol;
    if (typeof Symbol === "function" && typeof Symbol.for === "function") {
      gracefulQueue = /* @__PURE__ */ Symbol.for("graceful-fs.queue");
      previousSymbol = /* @__PURE__ */ Symbol.for("graceful-fs.previous");
    } else {
      gracefulQueue = "___graceful-fs.queue";
      previousSymbol = "___graceful-fs.previous";
    }
    function noop() {
    }
    function publishQueue(context, queue2) {
      Object.defineProperty(context, gracefulQueue, {
        get: function() {
          return queue2;
        }
      });
    }
    var debug = noop;
    if (util.debuglog)
      debug = util.debuglog("gfs4");
    else if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || ""))
      debug = function() {
        var m = util.format.apply(util, arguments);
        m = "GFS4: " + m.split(/\n/).join("\nGFS4: ");
        console.error(m);
      };
    if (!fs2[gracefulQueue]) {
      queue = global[gracefulQueue] || [];
      publishQueue(fs2, queue);
      fs2.close = (function(fs$close) {
        function close(fd, cb) {
          return fs$close.call(fs2, fd, function(err) {
            if (!err) {
              resetQueue();
            }
            if (typeof cb === "function")
              cb.apply(this, arguments);
          });
        }
        Object.defineProperty(close, previousSymbol, {
          value: fs$close
        });
        return close;
      })(fs2.close);
      fs2.closeSync = (function(fs$closeSync) {
        function closeSync(fd) {
          fs$closeSync.apply(fs2, arguments);
          resetQueue();
        }
        Object.defineProperty(closeSync, previousSymbol, {
          value: fs$closeSync
        });
        return closeSync;
      })(fs2.closeSync);
      if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || "")) {
        process.on("exit", function() {
          debug(fs2[gracefulQueue]);
          require("assert").equal(fs2[gracefulQueue].length, 0);
        });
      }
    }
    var queue;
    if (!global[gracefulQueue]) {
      publishQueue(global, fs2[gracefulQueue]);
    }
    module2.exports = patch(clone(fs2));
    if (process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH && !fs2.__patched) {
      module2.exports = patch(fs2);
      fs2.__patched = true;
    }
    function patch(fs3) {
      polyfills(fs3);
      fs3.gracefulify = patch;
      fs3.createReadStream = createReadStream;
      fs3.createWriteStream = createWriteStream;
      var fs$readFile = fs3.readFile;
      fs3.readFile = readFile;
      function readFile(path2, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$readFile(path2, options, cb);
        function go$readFile(path3, options2, cb2, startTime) {
          return fs$readFile(path3, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$readFile, [path3, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$writeFile = fs3.writeFile;
      fs3.writeFile = writeFile;
      function writeFile(path2, data, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$writeFile(path2, data, options, cb);
        function go$writeFile(path3, data2, options2, cb2, startTime) {
          return fs$writeFile(path3, data2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$writeFile, [path3, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$appendFile = fs3.appendFile;
      if (fs$appendFile)
        fs3.appendFile = appendFile;
      function appendFile(path2, data, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$appendFile(path2, data, options, cb);
        function go$appendFile(path3, data2, options2, cb2, startTime) {
          return fs$appendFile(path3, data2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$appendFile, [path3, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$copyFile = fs3.copyFile;
      if (fs$copyFile)
        fs3.copyFile = copyFile;
      function copyFile(src, dest, flags, cb) {
        if (typeof flags === "function") {
          cb = flags;
          flags = 0;
        }
        return go$copyFile(src, dest, flags, cb);
        function go$copyFile(src2, dest2, flags2, cb2, startTime) {
          return fs$copyFile(src2, dest2, flags2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$copyFile, [src2, dest2, flags2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$readdir = fs3.readdir;
      fs3.readdir = readdir;
      var noReaddirOptionVersions = /^v[0-5]\./;
      function readdir(path2, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        var go$readdir = noReaddirOptionVersions.test(process.version) ? function go$readdir2(path3, options2, cb2, startTime) {
          return fs$readdir(path3, fs$readdirCallback(
            path3,
            options2,
            cb2,
            startTime
          ));
        } : function go$readdir2(path3, options2, cb2, startTime) {
          return fs$readdir(path3, options2, fs$readdirCallback(
            path3,
            options2,
            cb2,
            startTime
          ));
        };
        return go$readdir(path2, options, cb);
        function fs$readdirCallback(path3, options2, cb2, startTime) {
          return function(err, files) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([
                go$readdir,
                [path3, options2, cb2],
                err,
                startTime || Date.now(),
                Date.now()
              ]);
            else {
              if (files && files.sort)
                files.sort();
              if (typeof cb2 === "function")
                cb2.call(this, err, files);
            }
          };
        }
      }
      if (process.version.substr(0, 4) === "v0.8") {
        var legStreams = legacy(fs3);
        ReadStream = legStreams.ReadStream;
        WriteStream = legStreams.WriteStream;
      }
      var fs$ReadStream = fs3.ReadStream;
      if (fs$ReadStream) {
        ReadStream.prototype = Object.create(fs$ReadStream.prototype);
        ReadStream.prototype.open = ReadStream$open;
      }
      var fs$WriteStream = fs3.WriteStream;
      if (fs$WriteStream) {
        WriteStream.prototype = Object.create(fs$WriteStream.prototype);
        WriteStream.prototype.open = WriteStream$open;
      }
      Object.defineProperty(fs3, "ReadStream", {
        get: function() {
          return ReadStream;
        },
        set: function(val) {
          ReadStream = val;
        },
        enumerable: true,
        configurable: true
      });
      Object.defineProperty(fs3, "WriteStream", {
        get: function() {
          return WriteStream;
        },
        set: function(val) {
          WriteStream = val;
        },
        enumerable: true,
        configurable: true
      });
      var FileReadStream = ReadStream;
      Object.defineProperty(fs3, "FileReadStream", {
        get: function() {
          return FileReadStream;
        },
        set: function(val) {
          FileReadStream = val;
        },
        enumerable: true,
        configurable: true
      });
      var FileWriteStream = WriteStream;
      Object.defineProperty(fs3, "FileWriteStream", {
        get: function() {
          return FileWriteStream;
        },
        set: function(val) {
          FileWriteStream = val;
        },
        enumerable: true,
        configurable: true
      });
      function ReadStream(path2, options) {
        if (this instanceof ReadStream)
          return fs$ReadStream.apply(this, arguments), this;
        else
          return ReadStream.apply(Object.create(ReadStream.prototype), arguments);
      }
      function ReadStream$open() {
        var that = this;
        open(that.path, that.flags, that.mode, function(err, fd) {
          if (err) {
            if (that.autoClose)
              that.destroy();
            that.emit("error", err);
          } else {
            that.fd = fd;
            that.emit("open", fd);
            that.read();
          }
        });
      }
      function WriteStream(path2, options) {
        if (this instanceof WriteStream)
          return fs$WriteStream.apply(this, arguments), this;
        else
          return WriteStream.apply(Object.create(WriteStream.prototype), arguments);
      }
      function WriteStream$open() {
        var that = this;
        open(that.path, that.flags, that.mode, function(err, fd) {
          if (err) {
            that.destroy();
            that.emit("error", err);
          } else {
            that.fd = fd;
            that.emit("open", fd);
          }
        });
      }
      function createReadStream(path2, options) {
        return new fs3.ReadStream(path2, options);
      }
      function createWriteStream(path2, options) {
        return new fs3.WriteStream(path2, options);
      }
      var fs$open = fs3.open;
      fs3.open = open;
      function open(path2, flags, mode, cb) {
        if (typeof mode === "function")
          cb = mode, mode = null;
        return go$open(path2, flags, mode, cb);
        function go$open(path3, flags2, mode2, cb2, startTime) {
          return fs$open(path3, flags2, mode2, function(err, fd) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$open, [path3, flags2, mode2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      return fs3;
    }
    function enqueue(elem) {
      debug("ENQUEUE", elem[0].name, elem[1]);
      fs2[gracefulQueue].push(elem);
      retry();
    }
    var retryTimer;
    function resetQueue() {
      var now = Date.now();
      for (var i = 0; i < fs2[gracefulQueue].length; ++i) {
        if (fs2[gracefulQueue][i].length > 2) {
          fs2[gracefulQueue][i][3] = now;
          fs2[gracefulQueue][i][4] = now;
        }
      }
      retry();
    }
    function retry() {
      clearTimeout(retryTimer);
      retryTimer = void 0;
      if (fs2[gracefulQueue].length === 0)
        return;
      var elem = fs2[gracefulQueue].shift();
      var fn = elem[0];
      var args = elem[1];
      var err = elem[2];
      var startTime = elem[3];
      var lastTime = elem[4];
      if (startTime === void 0) {
        debug("RETRY", fn.name, args);
        fn.apply(null, args);
      } else if (Date.now() - startTime >= 6e4) {
        debug("TIMEOUT", fn.name, args);
        var cb = args.pop();
        if (typeof cb === "function")
          cb.call(null, err);
      } else {
        var sinceAttempt = Date.now() - lastTime;
        var sinceStart = Math.max(lastTime - startTime, 1);
        var desiredDelay = Math.min(sinceStart * 1.2, 100);
        if (sinceAttempt >= desiredDelay) {
          debug("RETRY", fn.name, args);
          fn.apply(null, args.concat([startTime]));
        } else {
          fs2[gracefulQueue].push(elem);
        }
      }
      if (retryTimer === void 0) {
        retryTimer = setTimeout(retry, 0);
      }
    }
  }
});

// node_modules/retry/lib/retry_operation.js
var require_retry_operation = __commonJS({
  "node_modules/retry/lib/retry_operation.js"(exports2, module2) {
    function RetryOperation(timeouts, options) {
      if (typeof options === "boolean") {
        options = { forever: options };
      }
      this._originalTimeouts = JSON.parse(JSON.stringify(timeouts));
      this._timeouts = timeouts;
      this._options = options || {};
      this._maxRetryTime = options && options.maxRetryTime || Infinity;
      this._fn = null;
      this._errors = [];
      this._attempts = 1;
      this._operationTimeout = null;
      this._operationTimeoutCb = null;
      this._timeout = null;
      this._operationStart = null;
      if (this._options.forever) {
        this._cachedTimeouts = this._timeouts.slice(0);
      }
    }
    module2.exports = RetryOperation;
    RetryOperation.prototype.reset = function() {
      this._attempts = 1;
      this._timeouts = this._originalTimeouts;
    };
    RetryOperation.prototype.stop = function() {
      if (this._timeout) {
        clearTimeout(this._timeout);
      }
      this._timeouts = [];
      this._cachedTimeouts = null;
    };
    RetryOperation.prototype.retry = function(err) {
      if (this._timeout) {
        clearTimeout(this._timeout);
      }
      if (!err) {
        return false;
      }
      var currentTime = (/* @__PURE__ */ new Date()).getTime();
      if (err && currentTime - this._operationStart >= this._maxRetryTime) {
        this._errors.unshift(new Error("RetryOperation timeout occurred"));
        return false;
      }
      this._errors.push(err);
      var timeout = this._timeouts.shift();
      if (timeout === void 0) {
        if (this._cachedTimeouts) {
          this._errors.splice(this._errors.length - 1, this._errors.length);
          this._timeouts = this._cachedTimeouts.slice(0);
          timeout = this._timeouts.shift();
        } else {
          return false;
        }
      }
      var self = this;
      var timer = setTimeout(function() {
        self._attempts++;
        if (self._operationTimeoutCb) {
          self._timeout = setTimeout(function() {
            self._operationTimeoutCb(self._attempts);
          }, self._operationTimeout);
          if (self._options.unref) {
            self._timeout.unref();
          }
        }
        self._fn(self._attempts);
      }, timeout);
      if (this._options.unref) {
        timer.unref();
      }
      return true;
    };
    RetryOperation.prototype.attempt = function(fn, timeoutOps) {
      this._fn = fn;
      if (timeoutOps) {
        if (timeoutOps.timeout) {
          this._operationTimeout = timeoutOps.timeout;
        }
        if (timeoutOps.cb) {
          this._operationTimeoutCb = timeoutOps.cb;
        }
      }
      var self = this;
      if (this._operationTimeoutCb) {
        this._timeout = setTimeout(function() {
          self._operationTimeoutCb();
        }, self._operationTimeout);
      }
      this._operationStart = (/* @__PURE__ */ new Date()).getTime();
      this._fn(this._attempts);
    };
    RetryOperation.prototype.try = function(fn) {
      console.log("Using RetryOperation.try() is deprecated");
      this.attempt(fn);
    };
    RetryOperation.prototype.start = function(fn) {
      console.log("Using RetryOperation.start() is deprecated");
      this.attempt(fn);
    };
    RetryOperation.prototype.start = RetryOperation.prototype.try;
    RetryOperation.prototype.errors = function() {
      return this._errors;
    };
    RetryOperation.prototype.attempts = function() {
      return this._attempts;
    };
    RetryOperation.prototype.mainError = function() {
      if (this._errors.length === 0) {
        return null;
      }
      var counts = {};
      var mainError = null;
      var mainErrorCount = 0;
      for (var i = 0; i < this._errors.length; i++) {
        var error = this._errors[i];
        var message = error.message;
        var count = (counts[message] || 0) + 1;
        counts[message] = count;
        if (count >= mainErrorCount) {
          mainError = error;
          mainErrorCount = count;
        }
      }
      return mainError;
    };
  }
});

// node_modules/retry/lib/retry.js
var require_retry = __commonJS({
  "node_modules/retry/lib/retry.js"(exports2) {
    var RetryOperation = require_retry_operation();
    exports2.operation = function(options) {
      var timeouts = exports2.timeouts(options);
      return new RetryOperation(timeouts, {
        forever: options && options.forever,
        unref: options && options.unref,
        maxRetryTime: options && options.maxRetryTime
      });
    };
    exports2.timeouts = function(options) {
      if (options instanceof Array) {
        return [].concat(options);
      }
      var opts = {
        retries: 10,
        factor: 2,
        minTimeout: 1 * 1e3,
        maxTimeout: Infinity,
        randomize: false
      };
      for (var key in options) {
        opts[key] = options[key];
      }
      if (opts.minTimeout > opts.maxTimeout) {
        throw new Error("minTimeout is greater than maxTimeout");
      }
      var timeouts = [];
      for (var i = 0; i < opts.retries; i++) {
        timeouts.push(this.createTimeout(i, opts));
      }
      if (options && options.forever && !timeouts.length) {
        timeouts.push(this.createTimeout(i, opts));
      }
      timeouts.sort(function(a, b) {
        return a - b;
      });
      return timeouts;
    };
    exports2.createTimeout = function(attempt, opts) {
      var random = opts.randomize ? Math.random() + 1 : 1;
      var timeout = Math.round(random * opts.minTimeout * Math.pow(opts.factor, attempt));
      timeout = Math.min(timeout, opts.maxTimeout);
      return timeout;
    };
    exports2.wrap = function(obj, options, methods) {
      if (options instanceof Array) {
        methods = options;
        options = null;
      }
      if (!methods) {
        methods = [];
        for (var key in obj) {
          if (typeof obj[key] === "function") {
            methods.push(key);
          }
        }
      }
      for (var i = 0; i < methods.length; i++) {
        var method = methods[i];
        var original = obj[method];
        obj[method] = function retryWrapper(original2) {
          var op = exports2.operation(options);
          var args = Array.prototype.slice.call(arguments, 1);
          var callback = args.pop();
          args.push(function(err) {
            if (op.retry(err)) {
              return;
            }
            if (err) {
              arguments[0] = op.mainError();
            }
            callback.apply(this, arguments);
          });
          op.attempt(function() {
            original2.apply(obj, args);
          });
        }.bind(obj, original);
        obj[method].options = options;
      }
    };
  }
});

// node_modules/retry/index.js
var require_retry2 = __commonJS({
  "node_modules/retry/index.js"(exports2, module2) {
    module2.exports = require_retry();
  }
});

// node_modules/signal-exit/signals.js
var require_signals = __commonJS({
  "node_modules/signal-exit/signals.js"(exports2, module2) {
    module2.exports = [
      "SIGABRT",
      "SIGALRM",
      "SIGHUP",
      "SIGINT",
      "SIGTERM"
    ];
    if (process.platform !== "win32") {
      module2.exports.push(
        "SIGVTALRM",
        "SIGXCPU",
        "SIGXFSZ",
        "SIGUSR2",
        "SIGTRAP",
        "SIGSYS",
        "SIGQUIT",
        "SIGIOT"
        // should detect profiler and enable/disable accordingly.
        // see #21
        // 'SIGPROF'
      );
    }
    if (process.platform === "linux") {
      module2.exports.push(
        "SIGIO",
        "SIGPOLL",
        "SIGPWR",
        "SIGSTKFLT",
        "SIGUNUSED"
      );
    }
  }
});

// node_modules/signal-exit/index.js
var require_signal_exit = __commonJS({
  "node_modules/signal-exit/index.js"(exports2, module2) {
    var process2 = global.process;
    var processOk = function(process3) {
      return process3 && typeof process3 === "object" && typeof process3.removeListener === "function" && typeof process3.emit === "function" && typeof process3.reallyExit === "function" && typeof process3.listeners === "function" && typeof process3.kill === "function" && typeof process3.pid === "number" && typeof process3.on === "function";
    };
    if (!processOk(process2)) {
      module2.exports = function() {
        return function() {
        };
      };
    } else {
      assert = require("assert");
      signals = require_signals();
      isWin = /^win/i.test(process2.platform);
      EE = require("events");
      if (typeof EE !== "function") {
        EE = EE.EventEmitter;
      }
      if (process2.__signal_exit_emitter__) {
        emitter = process2.__signal_exit_emitter__;
      } else {
        emitter = process2.__signal_exit_emitter__ = new EE();
        emitter.count = 0;
        emitter.emitted = {};
      }
      if (!emitter.infinite) {
        emitter.setMaxListeners(Infinity);
        emitter.infinite = true;
      }
      module2.exports = function(cb, opts) {
        if (!processOk(global.process)) {
          return function() {
          };
        }
        assert.equal(typeof cb, "function", "a callback must be provided for exit handler");
        if (loaded === false) {
          load();
        }
        var ev = "exit";
        if (opts && opts.alwaysLast) {
          ev = "afterexit";
        }
        var remove = function() {
          emitter.removeListener(ev, cb);
          if (emitter.listeners("exit").length === 0 && emitter.listeners("afterexit").length === 0) {
            unload();
          }
        };
        emitter.on(ev, cb);
        return remove;
      };
      unload = function unload2() {
        if (!loaded || !processOk(global.process)) {
          return;
        }
        loaded = false;
        signals.forEach(function(sig) {
          try {
            process2.removeListener(sig, sigListeners[sig]);
          } catch (er) {
          }
        });
        process2.emit = originalProcessEmit;
        process2.reallyExit = originalProcessReallyExit;
        emitter.count -= 1;
      };
      module2.exports.unload = unload;
      emit = function emit2(event, code, signal) {
        if (emitter.emitted[event]) {
          return;
        }
        emitter.emitted[event] = true;
        emitter.emit(event, code, signal);
      };
      sigListeners = {};
      signals.forEach(function(sig) {
        sigListeners[sig] = function listener() {
          if (!processOk(global.process)) {
            return;
          }
          var listeners = process2.listeners(sig);
          if (listeners.length === emitter.count) {
            unload();
            emit("exit", null, sig);
            emit("afterexit", null, sig);
            if (isWin && sig === "SIGHUP") {
              sig = "SIGINT";
            }
            process2.kill(process2.pid, sig);
          }
        };
      });
      module2.exports.signals = function() {
        return signals;
      };
      loaded = false;
      load = function load2() {
        if (loaded || !processOk(global.process)) {
          return;
        }
        loaded = true;
        emitter.count += 1;
        signals = signals.filter(function(sig) {
          try {
            process2.on(sig, sigListeners[sig]);
            return true;
          } catch (er) {
            return false;
          }
        });
        process2.emit = processEmit;
        process2.reallyExit = processReallyExit;
      };
      module2.exports.load = load;
      originalProcessReallyExit = process2.reallyExit;
      processReallyExit = function processReallyExit2(code) {
        if (!processOk(global.process)) {
          return;
        }
        process2.exitCode = code || /* istanbul ignore next */
        0;
        emit("exit", process2.exitCode, null);
        emit("afterexit", process2.exitCode, null);
        originalProcessReallyExit.call(process2, process2.exitCode);
      };
      originalProcessEmit = process2.emit;
      processEmit = function processEmit2(ev, arg) {
        if (ev === "exit" && processOk(global.process)) {
          if (arg !== void 0) {
            process2.exitCode = arg;
          }
          var ret = originalProcessEmit.apply(this, arguments);
          emit("exit", process2.exitCode, null);
          emit("afterexit", process2.exitCode, null);
          return ret;
        } else {
          return originalProcessEmit.apply(this, arguments);
        }
      };
    }
    var assert;
    var signals;
    var isWin;
    var EE;
    var emitter;
    var unload;
    var emit;
    var sigListeners;
    var loaded;
    var load;
    var originalProcessReallyExit;
    var processReallyExit;
    var originalProcessEmit;
    var processEmit;
  }
});

// node_modules/proper-lockfile/lib/mtime-precision.js
var require_mtime_precision = __commonJS({
  "node_modules/proper-lockfile/lib/mtime-precision.js"(exports2, module2) {
    "use strict";
    var cacheSymbol = /* @__PURE__ */ Symbol();
    function probe(file, fs2, callback) {
      const cachedPrecision = fs2[cacheSymbol];
      if (cachedPrecision) {
        return fs2.stat(file, (err, stat) => {
          if (err) {
            return callback(err);
          }
          callback(null, stat.mtime, cachedPrecision);
        });
      }
      const mtime = new Date(Math.ceil(Date.now() / 1e3) * 1e3 + 5);
      fs2.utimes(file, mtime, mtime, (err) => {
        if (err) {
          return callback(err);
        }
        fs2.stat(file, (err2, stat) => {
          if (err2) {
            return callback(err2);
          }
          const precision = stat.mtime.getTime() % 1e3 === 0 ? "s" : "ms";
          Object.defineProperty(fs2, cacheSymbol, { value: precision });
          callback(null, stat.mtime, precision);
        });
      });
    }
    function getMtime(precision) {
      let now = Date.now();
      if (precision === "s") {
        now = Math.ceil(now / 1e3) * 1e3;
      }
      return new Date(now);
    }
    module2.exports.probe = probe;
    module2.exports.getMtime = getMtime;
  }
});

// node_modules/proper-lockfile/lib/lockfile.js
var require_lockfile = __commonJS({
  "node_modules/proper-lockfile/lib/lockfile.js"(exports2, module2) {
    "use strict";
    var path2 = require("path");
    var fs2 = require_graceful_fs();
    var retry = require_retry2();
    var onExit = require_signal_exit();
    var mtimePrecision = require_mtime_precision();
    var locks = {};
    function getLockFile(file, options) {
      return options.lockfilePath || `${file}.lock`;
    }
    function resolveCanonicalPath(file, options, callback) {
      if (!options.realpath) {
        return callback(null, path2.resolve(file));
      }
      options.fs.realpath(file, callback);
    }
    function acquireLock(file, options, callback) {
      const lockfilePath = getLockFile(file, options);
      options.fs.mkdir(lockfilePath, (err) => {
        if (!err) {
          return mtimePrecision.probe(lockfilePath, options.fs, (err2, mtime, mtimePrecision2) => {
            if (err2) {
              options.fs.rmdir(lockfilePath, () => {
              });
              return callback(err2);
            }
            callback(null, mtime, mtimePrecision2);
          });
        }
        if (err.code !== "EEXIST") {
          return callback(err);
        }
        if (options.stale <= 0) {
          return callback(Object.assign(new Error("Lock file is already being held"), { code: "ELOCKED", file }));
        }
        options.fs.stat(lockfilePath, (err2, stat) => {
          if (err2) {
            if (err2.code === "ENOENT") {
              return acquireLock(file, { ...options, stale: 0 }, callback);
            }
            return callback(err2);
          }
          if (!isLockStale(stat, options)) {
            return callback(Object.assign(new Error("Lock file is already being held"), { code: "ELOCKED", file }));
          }
          removeLock(file, options, (err3) => {
            if (err3) {
              return callback(err3);
            }
            acquireLock(file, { ...options, stale: 0 }, callback);
          });
        });
      });
    }
    function isLockStale(stat, options) {
      return stat.mtime.getTime() < Date.now() - options.stale;
    }
    function removeLock(file, options, callback) {
      options.fs.rmdir(getLockFile(file, options), (err) => {
        if (err && err.code !== "ENOENT") {
          return callback(err);
        }
        callback();
      });
    }
    function updateLock(file, options) {
      const lock2 = locks[file];
      if (lock2.updateTimeout) {
        return;
      }
      lock2.updateDelay = lock2.updateDelay || options.update;
      lock2.updateTimeout = setTimeout(() => {
        lock2.updateTimeout = null;
        options.fs.stat(lock2.lockfilePath, (err, stat) => {
          const isOverThreshold = lock2.lastUpdate + options.stale < Date.now();
          if (err) {
            if (err.code === "ENOENT" || isOverThreshold) {
              return setLockAsCompromised(file, lock2, Object.assign(err, { code: "ECOMPROMISED" }));
            }
            lock2.updateDelay = 1e3;
            return updateLock(file, options);
          }
          const isMtimeOurs = lock2.mtime.getTime() === stat.mtime.getTime();
          if (!isMtimeOurs) {
            return setLockAsCompromised(
              file,
              lock2,
              Object.assign(
                new Error("Unable to update lock within the stale threshold"),
                { code: "ECOMPROMISED" }
              )
            );
          }
          const mtime = mtimePrecision.getMtime(lock2.mtimePrecision);
          options.fs.utimes(lock2.lockfilePath, mtime, mtime, (err2) => {
            const isOverThreshold2 = lock2.lastUpdate + options.stale < Date.now();
            if (lock2.released) {
              return;
            }
            if (err2) {
              if (err2.code === "ENOENT" || isOverThreshold2) {
                return setLockAsCompromised(file, lock2, Object.assign(err2, { code: "ECOMPROMISED" }));
              }
              lock2.updateDelay = 1e3;
              return updateLock(file, options);
            }
            lock2.mtime = mtime;
            lock2.lastUpdate = Date.now();
            lock2.updateDelay = null;
            updateLock(file, options);
          });
        });
      }, lock2.updateDelay);
      if (lock2.updateTimeout.unref) {
        lock2.updateTimeout.unref();
      }
    }
    function setLockAsCompromised(file, lock2, err) {
      lock2.released = true;
      if (lock2.updateTimeout) {
        clearTimeout(lock2.updateTimeout);
      }
      if (locks[file] === lock2) {
        delete locks[file];
      }
      lock2.options.onCompromised(err);
    }
    function lock(file, options, callback) {
      options = {
        stale: 1e4,
        update: null,
        realpath: true,
        retries: 0,
        fs: fs2,
        onCompromised: (err) => {
          throw err;
        },
        ...options
      };
      options.retries = options.retries || 0;
      options.retries = typeof options.retries === "number" ? { retries: options.retries } : options.retries;
      options.stale = Math.max(options.stale || 0, 2e3);
      options.update = options.update == null ? options.stale / 2 : options.update || 0;
      options.update = Math.max(Math.min(options.update, options.stale / 2), 1e3);
      resolveCanonicalPath(file, options, (err, file2) => {
        if (err) {
          return callback(err);
        }
        const operation = retry.operation(options.retries);
        operation.attempt(() => {
          acquireLock(file2, options, (err2, mtime, mtimePrecision2) => {
            if (operation.retry(err2)) {
              return;
            }
            if (err2) {
              return callback(operation.mainError());
            }
            const lock2 = locks[file2] = {
              lockfilePath: getLockFile(file2, options),
              mtime,
              mtimePrecision: mtimePrecision2,
              options,
              lastUpdate: Date.now()
            };
            updateLock(file2, options);
            callback(null, (releasedCallback) => {
              if (lock2.released) {
                return releasedCallback && releasedCallback(Object.assign(new Error("Lock is already released"), { code: "ERELEASED" }));
              }
              unlock(file2, { ...options, realpath: false }, releasedCallback);
            });
          });
        });
      });
    }
    function unlock(file, options, callback) {
      options = {
        fs: fs2,
        realpath: true,
        ...options
      };
      resolveCanonicalPath(file, options, (err, file2) => {
        if (err) {
          return callback(err);
        }
        const lock2 = locks[file2];
        if (!lock2) {
          return callback(Object.assign(new Error("Lock is not acquired/owned by you"), { code: "ENOTACQUIRED" }));
        }
        lock2.updateTimeout && clearTimeout(lock2.updateTimeout);
        lock2.released = true;
        delete locks[file2];
        removeLock(file2, options, callback);
      });
    }
    function check(file, options, callback) {
      options = {
        stale: 1e4,
        realpath: true,
        fs: fs2,
        ...options
      };
      options.stale = Math.max(options.stale || 0, 2e3);
      resolveCanonicalPath(file, options, (err, file2) => {
        if (err) {
          return callback(err);
        }
        options.fs.stat(getLockFile(file2, options), (err2, stat) => {
          if (err2) {
            return err2.code === "ENOENT" ? callback(null, false) : callback(err2);
          }
          return callback(null, !isLockStale(stat, options));
        });
      });
    }
    function getLocks() {
      return locks;
    }
    onExit(() => {
      for (const file in locks) {
        const options = locks[file].options;
        try {
          options.fs.rmdirSync(getLockFile(file, options));
        } catch (e) {
        }
      }
    });
    module2.exports.lock = lock;
    module2.exports.unlock = unlock;
    module2.exports.check = check;
    module2.exports.getLocks = getLocks;
  }
});

// node_modules/proper-lockfile/lib/adapter.js
var require_adapter = __commonJS({
  "node_modules/proper-lockfile/lib/adapter.js"(exports2, module2) {
    "use strict";
    var fs2 = require_graceful_fs();
    function createSyncFs(fs3) {
      const methods = ["mkdir", "realpath", "stat", "rmdir", "utimes"];
      const newFs = { ...fs3 };
      methods.forEach((method) => {
        newFs[method] = (...args) => {
          const callback = args.pop();
          let ret;
          try {
            ret = fs3[`${method}Sync`](...args);
          } catch (err) {
            return callback(err);
          }
          callback(null, ret);
        };
      });
      return newFs;
    }
    function toPromise(method) {
      return (...args) => new Promise((resolve, reject) => {
        args.push((err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        });
        method(...args);
      });
    }
    function toSync(method) {
      return (...args) => {
        let err;
        let result;
        args.push((_err, _result) => {
          err = _err;
          result = _result;
        });
        method(...args);
        if (err) {
          throw err;
        }
        return result;
      };
    }
    function toSyncOptions(options) {
      options = { ...options };
      options.fs = createSyncFs(options.fs || fs2);
      if (typeof options.retries === "number" && options.retries > 0 || options.retries && typeof options.retries.retries === "number" && options.retries.retries > 0) {
        throw Object.assign(new Error("Cannot use retries with the sync api"), { code: "ESYNC" });
      }
      return options;
    }
    module2.exports = {
      toPromise,
      toSync,
      toSyncOptions
    };
  }
});

// node_modules/proper-lockfile/index.js
var require_proper_lockfile = __commonJS({
  "node_modules/proper-lockfile/index.js"(exports2, module2) {
    "use strict";
    var lockfile = require_lockfile();
    var { toPromise, toSync, toSyncOptions } = require_adapter();
    async function lock(file, options) {
      const release = await toPromise(lockfile.lock)(file, options);
      return toPromise(release);
    }
    function lockSync(file, options) {
      const release = toSync(lockfile.lock)(file, toSyncOptions(options));
      return toSync(release);
    }
    function unlock(file, options) {
      return toPromise(lockfile.unlock)(file, options);
    }
    function unlockSync(file, options) {
      return toSync(lockfile.unlock)(file, toSyncOptions(options));
    }
    function check(file, options) {
      return toPromise(lockfile.check)(file, options);
    }
    function checkSync(file, options) {
      return toSync(lockfile.check)(file, toSyncOptions(options));
    }
    module2.exports = lock;
    module2.exports.lock = lock;
    module2.exports.unlock = unlock;
    module2.exports.lockSync = lockSync;
    module2.exports.unlockSync = unlockSync;
    module2.exports.check = check;
    module2.exports.checkSync = checkSync;
  }
});

// out/storage.js
var require_storage = __commonJS({
  "out/storage.js"(exports2) {
    "use strict";
    var __createBinding2 = exports2 && exports2.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault2 = exports2 && exports2.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar2 = exports2 && exports2.__importStar || /* @__PURE__ */ (function() {
      var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function(o2) {
          var ar = [];
          for (var k in o2) if (Object.prototype.hasOwnProperty.call(o2, k)) ar[ar.length] = k;
          return ar;
        };
        return ownKeys(o);
      };
      return function(mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) {
          for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding2(result, mod, k[i]);
        }
        __setModuleDefault2(result, mod);
        return result;
      };
    })();
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.normalizeRoot = normalizeRoot;
    exports2.wayfinderHome = wayfinderHome;
    exports2.projectIdFor = projectIdFor;
    exports2.projectDataDir = projectDataDir;
    exports2.statePathFor = statePathFor;
    exports2.configPathFor = configPathFor;
    exports2.shadowGitDirFor = shadowGitDirFor;
    exports2.ensureProjectState = ensureProjectState;
    exports2.readProjectState = readProjectState;
    exports2.writeProjectState = writeProjectState;
    exports2.mutateProjectState = mutateProjectState;
    exports2.readProjectConfig = readProjectConfig;
    exports2.writeProjectConfig = writeProjectConfig;
    exports2.latestNodeOnBranch = latestNodeOnBranch;
    exports2.createId = createId;
    exports2.clip = clip;
    exports2.clipText = clipText;
    var crypto_1 = require("crypto");
    var fs2 = __importStar2(require("fs"));
    var os = __importStar2(require("os"));
    var path2 = __importStar2(require("path"));
    var lockfile = __importStar2(require_proper_lockfile());
    var STATE_VERSION = 1;
    var DEFAULT_CONFIG = {
      validationTimeoutSeconds: 60,
      maxFileSizeMB: 20
    };
    function normalizeRoot(root) {
      try {
        return fs2.realpathSync.native(root);
      } catch {
        return path2.resolve(root);
      }
    }
    function wayfinderHome() {
      return process.env.WAYFINDER_HOME || path2.join(os.homedir(), ".wayfinder");
    }
    function projectIdFor(root) {
      return (0, crypto_1.createHash)("sha256").update(normalizeRoot(root)).digest("hex").slice(0, 20);
    }
    function projectDataDir(root) {
      return path2.join(wayfinderHome(), "projects", projectIdFor(root));
    }
    function statePathFor(root) {
      return path2.join(projectDataDir(root), "timeline.json");
    }
    function configPathFor(root) {
      return path2.join(projectDataDir(root), "config.json");
    }
    function shadowGitDirFor(root) {
      return path2.join(projectDataDir(root), "shadow.git");
    }
    async function ensureProjectState(root) {
      const normalized = normalizeRoot(root);
      const existing = await readProjectState(normalized);
      if (existing) {
        return existing;
      }
      const main = {
        id: "main",
        name: "main",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      const state = {
        version: STATE_VERSION,
        projectId: projectIdFor(normalized),
        root: normalized,
        activeBranchId: main.id,
        branches: [main],
        nodes: [],
        pending: {},
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      await writeProjectState(normalized, state);
      return state;
    }
    async function readProjectState(root) {
      const file = statePathFor(root);
      try {
        const raw = await fs2.promises.readFile(file, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.version !== STATE_VERSION || !Array.isArray(parsed.nodes)) {
          throw new Error(`Unsupported or invalid Wayfinder state: ${file}`);
        }
        parsed.pending ||= {};
        return parsed;
      } catch (error) {
        if (isMissingFile(error)) {
          return void 0;
        }
        throw new Error(`Unable to read Wayfinder state ${file}: ${errorMessage(error)}`);
      }
    }
    async function writeProjectState(root, state) {
      const file = statePathFor(root);
      await fs2.promises.mkdir(path2.dirname(file), { recursive: true });
      state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      const temp = `${file}.${process.pid}.${(0, crypto_1.randomUUID)()}.tmp`;
      await fs2.promises.writeFile(temp, `${JSON.stringify(state, null, 2)}
`, "utf8");
      await fs2.promises.rename(temp, file);
    }
    async function mutateProjectState(root, mutate) {
      const normalized = normalizeRoot(root);
      return withProjectLock(normalized, async () => {
        const state = await ensureProjectState(normalized);
        const result = await mutate(state);
        await writeProjectState(normalized, state);
        return result;
      });
    }
    async function readProjectConfig(root) {
      const file = configPathFor(root);
      try {
        const raw = await fs2.promises.readFile(file, "utf8");
        const config = {
          ...DEFAULT_CONFIG,
          ...JSON.parse(raw)
        };
        return config;
      } catch (error) {
        if (isMissingFile(error)) {
          return { ...DEFAULT_CONFIG };
        }
        throw new Error(`Unable to read Wayfinder config ${file}: ${errorMessage(error)}`);
      }
    }
    async function writeProjectConfig(root, config) {
      const file = configPathFor(root);
      await fs2.promises.mkdir(path2.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.${(0, crypto_1.randomUUID)()}.tmp`;
      await fs2.promises.writeFile(temp, `${JSON.stringify(config, null, 2)}
`, "utf8");
      await fs2.promises.rename(temp, file);
    }
    function latestNodeOnBranch(state, branchId = state.activeBranchId) {
      const branchNodes = state.nodes.filter((node) => node.branchId === branchId);
      if (branchNodes.length > 0) {
        return branchNodes.sort((a, b) => a.completedAt.localeCompare(b.completedAt))[branchNodes.length - 1];
      }
      const branch = state.branches.find((item) => item.id === branchId);
      return branch?.parentNodeId ? state.nodes.find((node) => node.id === branch.parentNodeId) : void 0;
    }
    function createId(prefix) {
      return `${prefix}-${Date.now().toString(36)}-${(0, crypto_1.randomUUID)().slice(0, 8)}`;
    }
    function clip(text, max = 500) {
      const clean = (text || "").replace(/\s+/g, " ").trim();
      return clean.length > max ? `${clean.slice(0, max - 1)}\u2026` : clean;
    }
    function clipText(text, max = 500) {
      const clean = (text || "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
      return clean.length > max ? `${clean.slice(0, max - 1)}\u2026` : clean;
    }
    function isMissingFile(error) {
      return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
    }
    function errorMessage(error) {
      return error instanceof Error ? error.message : String(error);
    }
    async function withProjectLock(root, operation) {
      const dir = projectDataDir(root);
      await fs2.promises.mkdir(dir, { recursive: true });
      const target = statePathFor(root);
      const release = await lockfile.lock(target, {
        realpath: false,
        stale: 8e3,
        update: 2e3,
        retries: {
          retries: 300,
          factor: 1,
          minTimeout: 40,
          maxTimeout: 40
        }
      });
      try {
        return await operation();
      } finally {
        await release().catch(() => void 0);
      }
    }
  }
});

// out/shadowRepo.js
var require_shadowRepo = __commonJS({
  "out/shadowRepo.js"(exports2) {
    "use strict";
    var __createBinding2 = exports2 && exports2.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault2 = exports2 && exports2.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar2 = exports2 && exports2.__importStar || /* @__PURE__ */ (function() {
      var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function(o2) {
          var ar = [];
          for (var k in o2) if (Object.prototype.hasOwnProperty.call(o2, k)) ar[ar.length] = k;
          return ar;
        };
        return ownKeys(o);
      };
      return function(mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) {
          for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding2(result, mod, k[i]);
        }
        __setModuleDefault2(result, mod);
        return result;
      };
    })();
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.ShadowRepo = void 0;
    var child_process_12 = require("child_process");
    var fs2 = __importStar2(require("fs"));
    var path2 = __importStar2(require("path"));
    var util_1 = require("util");
    var storage_12 = require_storage();
    var execFileAsync = (0, util_1.promisify)(child_process_12.execFile);
    var DEFAULT_EXCLUDES = [
      ".git/",
      ".trae/",
      ".claude/",
      ".codex/",
      ".wayfinder/",
      "node_modules/",
      "dist/",
      "out/",
      "build/",
      ".next/",
      "coverage/",
      ".venv/",
      "venv/",
      "__pycache__/",
      "*.vsix",
      "*.dmg",
      "*.iso",
      ".DS_Store"
    ];
    var ShadowRepo = class {
      root;
      maxFileSizeMB;
      gitDir;
      initialized = false;
      constructor(root, maxFileSizeMB = 20) {
        this.root = root;
        this.maxFileSizeMB = maxFileSizeMB;
        this.gitDir = (0, storage_12.shadowGitDirFor)(root);
      }
      async init() {
        if (this.initialized) {
          return;
        }
        await fs2.promises.mkdir(path2.dirname(this.gitDir), { recursive: true });
        if (!fs2.existsSync(path2.join(this.gitDir, "HEAD"))) {
          await execFileAsync("git", ["--git-dir", this.gitDir, "--work-tree", this.root, "init"], { cwd: this.root });
        }
        await this.run(["config", "user.name", "Wayfinder"]);
        await this.run(["config", "user.email", "wayfinder@localhost"]);
        await this.run(["config", "commit.gpgsign", "false"]);
        await this.run(["config", "core.autocrlf", "false"]);
        await this.run(["config", "core.hooksPath", path2.join(this.gitDir, "no-hooks")]);
        const info = path2.join(this.gitDir, "info");
        await fs2.promises.mkdir(info, { recursive: true });
        await fs2.promises.writeFile(path2.join(info, "exclude"), `${DEFAULT_EXCLUDES.join("\n")}
`, "utf8");
        this.initialized = true;
      }
      async capture(id, label, parent) {
        await this.init();
        const indexDir = path2.join((0, storage_12.projectDataDir)(this.root), "indexes");
        await fs2.promises.mkdir(indexDir, { recursive: true });
        const indexPath = path2.join(indexDir, (0, storage_12.createId)("index"));
        const env = { GIT_INDEX_FILE: indexPath };
        try {
          if (parent) {
            await this.run(["read-tree", parent], env);
          } else {
            await this.run(["read-tree", "--empty"], env);
          }
          await this.run(["add", "-A"], env);
          await this.unstageLargeFiles(parent, env);
          const tree = (await this.run(["write-tree"], env)).trim();
          const parentTree = parent ? (await this.run(["rev-parse", `${parent}^{tree}`])).trim() : void 0;
          if (parent && parentTree === tree) {
            await this.updateRef(id, parent);
            return { commit: parent, parent, tree, changed: false };
          }
          const args = ["commit-tree", tree, "-m", label];
          if (parent) {
            args.push("-p", parent);
          }
          const now = (/* @__PURE__ */ new Date()).toISOString();
          const commit = (await this.run(args, {
            ...env,
            GIT_AUTHOR_NAME: "Wayfinder",
            GIT_AUTHOR_EMAIL: "wayfinder@localhost",
            GIT_AUTHOR_DATE: now,
            GIT_COMMITTER_NAME: "Wayfinder",
            GIT_COMMITTER_EMAIL: "wayfinder@localhost",
            GIT_COMMITTER_DATE: now
          })).trim();
          await this.updateRef(id, commit);
          return { commit, parent, tree, changed: true };
        } finally {
          await fs2.promises.rm(indexPath, { force: true }).catch(() => void 0);
        }
      }
      async diffFiles(from, to) {
        await this.init();
        if (from === to) {
          return [];
        }
        const [statusOutput, numstatOutput] = await Promise.all([
          this.run(["diff", "--name-status", "-z", "--find-renames", from, to]),
          this.run(["diff", "--numstat", "-z", "--find-renames", from, to])
        ]);
        const stats = /* @__PURE__ */ new Map();
        const numstatParts = numstatOutput.split("\0");
        for (let index = 0; index < numstatParts.length; index += 1) {
          const record = numstatParts[index];
          if (!record) {
            continue;
          }
          const firstTab = record.indexOf("	");
          const secondTab = record.indexOf("	", firstTab + 1);
          if (firstTab < 0 || secondTab < 0) {
            continue;
          }
          const added = record.slice(0, firstTab);
          const deleted = record.slice(firstTab + 1, secondTab);
          const filePathInRecord = record.slice(secondTab + 1);
          const renamed = filePathInRecord === "";
          const filePath = renamed ? numstatParts[index + 2] : filePathInRecord;
          if (renamed) {
            index += 2;
          }
          if (!filePath) {
            continue;
          }
          stats.set(filePath, {
            additions: added === "-" ? 0 : Number.parseInt(added, 10) || 0,
            deletions: deleted === "-" ? 0 : Number.parseInt(deleted, 10) || 0,
            binary: added === "-" || deleted === "-"
          });
        }
        const changes = [];
        const statusParts = statusOutput.split("\0");
        for (let index = 0; index < statusParts.length; index += 1) {
          const rawStatus = statusParts[index];
          if (!rawStatus) {
            continue;
          }
          const status = rawStatus.charAt(0);
          const firstPath = statusParts[index + 1];
          const filePath = status === "R" ? statusParts[index + 2] : firstPath;
          index += status === "R" ? 2 : 1;
          if (!filePath) {
            continue;
          }
          const stat = stats.get(filePath) || {
            additions: 0,
            deletions: 0,
            binary: false
          };
          changes.push({ path: filePath, status, ...stat });
        }
        return changes;
      }
      async diffText(from, to, relPath) {
        await this.init();
        const args = ["diff", "--no-color", "--unified=3", from, to];
        if (relPath) {
          args.push("--", relPath);
        }
        return this.run(args);
      }
      async fileAt(commit, relPath) {
        await this.init();
        try {
          const { stdout } = await execFileAsync("git", [
            "--git-dir",
            this.gitDir,
            "--work-tree",
            this.root,
            "show",
            `${commit}:${toPosix(relPath)}`
          ], {
            cwd: this.root,
            encoding: "buffer",
            maxBuffer: 64 * 1024 * 1024
          });
          return stdout;
        } catch {
          return void 0;
        }
      }
      async restore(target, current) {
        await this.init();
        const indexDir = path2.join((0, storage_12.projectDataDir)(this.root), "indexes");
        await fs2.promises.mkdir(indexDir, { recursive: true });
        const indexPath = path2.join(indexDir, (0, storage_12.createId)("restore"));
        const env = { GIT_INDEX_FILE: indexPath };
        try {
          await this.run(["read-tree", current], env);
          await this.run(["update-index", "--refresh"], env, true);
          const modified = (await this.run(["diff-files", "--name-only", "-z"], env)).split("\0").filter(Boolean);
          const collisions = [];
          const targetWrites = (await this.run(["diff", "--name-only", "--diff-filter=ACMR", "-z", current, target], env)).split("\0").filter(Boolean);
          for (const relPath of targetWrites) {
            if (!await this.existsAt(current, relPath) && fs2.existsSync(path2.join(this.root, relPath))) {
              collisions.push(relPath);
            }
          }
          const unsafe = [.../* @__PURE__ */ new Set([...modified, ...collisions])];
          if (unsafe.length > 0) {
            throw new Error(`\u4EE5\u4E0B\u6587\u4EF6\u672A\u88AB\u5B89\u5168\u5FEB\u7167\u5B8C\u6574\u4FDD\u5B58\uFF0C\u5DF2\u53D6\u6D88\u6062\u590D\uFF1A${unsafe.slice(0, 5).join(", ")}`);
          }
          await this.run(["read-tree", "-m", "-u", target], env);
        } finally {
          await fs2.promises.rm(indexPath, { force: true }).catch(() => void 0);
        }
      }
      async deleteRef(id) {
        await this.init();
        await this.run(["update-ref", "-d", this.refName(id)], {}, true);
      }
      async updateRef(id, commit) {
        await this.run(["update-ref", this.refName(id), commit]);
      }
      refName(id) {
        return `refs/wayfinder/${sanitizeRef(id)}`;
      }
      async unstageLargeFiles(parent, env) {
        const output = parent ? await this.run(["diff", "--cached", "--name-only", "-z", parent], env, true) : await this.run(["ls-files", "-z"], env, true);
        if (!output) {
          return;
        }
        const limit = this.maxFileSizeMB * 1024 * 1024;
        for (const relPath of output.split("\0").filter(Boolean)) {
          try {
            const stat = await fs2.promises.stat(path2.join(this.root, relPath));
            if (!stat.isFile() || stat.size <= limit) {
              continue;
            }
            if (parent && await this.existsAt(parent, relPath)) {
              await this.run(["reset", "-q", parent, "--", relPath], env, true);
            } else {
              await this.run(["rm", "--cached", "-q", "--ignore-unmatch", "--", relPath], env, true);
            }
          } catch {
          }
        }
      }
      async existsAt(commit, relPath) {
        try {
          await this.run(["cat-file", "-e", `${commit}:${toPosix(relPath)}`]);
          return true;
        } catch {
          return false;
        }
      }
      async run(args, extraEnv = {}, allowFail = false) {
        try {
          const { stdout } = await execFileAsync("git", ["--git-dir", this.gitDir, "--work-tree", this.root, ...args], {
            cwd: this.root,
            env: {
              ...process.env,
              GIT_OPTIONAL_LOCKS: "0",
              GIT_LITERAL_PATHSPECS: "1",
              ...extraEnv
            },
            maxBuffer: 64 * 1024 * 1024
          });
          return String(stdout || "");
        } catch (error) {
          if (allowFail) {
            return "";
          }
          const message = error.stderr || error.message;
          throw new Error(`git ${args[0]} failed: ${message}`);
        }
      }
    };
    exports2.ShadowRepo = ShadowRepo;
    function sanitizeRef(value) {
      return value.replace(/[^a-zA-Z0-9/_-]/g, "_");
    }
    function toPosix(value) {
      return value.replace(/\\/g, "/");
    }
  }
});

// out/transcript.js
var require_transcript = __commonJS({
  "out/transcript.js"(exports2) {
    "use strict";
    var __createBinding2 = exports2 && exports2.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault2 = exports2 && exports2.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar2 = exports2 && exports2.__importStar || /* @__PURE__ */ (function() {
      var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function(o2) {
          var ar = [];
          for (var k in o2) if (Object.prototype.hasOwnProperty.call(o2, k)) ar[ar.length] = k;
          return ar;
        };
        return ownKeys(o);
      };
      return function(mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) {
          for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding2(result, mod, k[i]);
        }
        __setModuleDefault2(result, mod);
        return result;
      };
    })();
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.readLastAssistantMessage = readLastAssistantMessage;
    exports2.assistantTextFromLine = assistantTextFromLine;
    var fs2 = __importStar2(require("fs"));
    var MAX_TRANSCRIPT_TAIL_BYTES = 2 * 1024 * 1024;
    async function readLastAssistantMessage(transcriptPath) {
      if (!transcriptPath) {
        return void 0;
      }
      try {
        const stat = await fs2.promises.stat(transcriptPath);
        if (!stat.isFile()) {
          return void 0;
        }
        const length = Math.min(stat.size, MAX_TRANSCRIPT_TAIL_BYTES);
        const handle = await fs2.promises.open(transcriptPath, "r");
        try {
          const buffer = Buffer.alloc(length);
          await handle.read(buffer, 0, length, stat.size - length);
          const lines = buffer.toString("utf8").split(/\r?\n/);
          for (let index = lines.length - 1; index >= 0; index -= 1) {
            const text = assistantTextFromLine(lines[index]);
            if (text) {
              return text;
            }
          }
        } finally {
          await handle.close();
        }
      } catch {
        return void 0;
      }
      return void 0;
    }
    function assistantTextFromLine(line) {
      if (!line.trim()) {
        return void 0;
      }
      try {
        const value = JSON.parse(line);
        return assistantText(value);
      } catch {
        return void 0;
      }
    }
    function assistantText(value) {
      const message = asRecord(value.message);
      if (value.type === "assistant" && message?.role === "assistant") {
        return contentText(message.content);
      }
      const payload = asRecord(value.payload);
      if (value.type === "response_item" && payload?.type === "message" && payload.role === "assistant") {
        return contentText(payload.content);
      }
      if (value.type === "event_msg" && payload?.type === "agent_message" && typeof payload.message === "string") {
        return payload.message.trim() || void 0;
      }
      if (value.role === "assistant") {
        return contentText(value.content);
      }
      return void 0;
    }
    function contentText(content) {
      if (typeof content === "string") {
        return content.trim() || void 0;
      }
      if (!Array.isArray(content)) {
        return void 0;
      }
      const text = content.map((item) => {
        const part = asRecord(item);
        if (!part || !["text", "output_text"].includes(String(part.type))) {
          return "";
        }
        return typeof part.text === "string" ? part.text : "";
      }).filter(Boolean).join("\n").trim();
      return text || void 0;
    }
    function asRecord(value) {
      return value && typeof value === "object" ? value : void 0;
    }
  }
});

// out/hook.js
var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
  if (k2 === void 0) k2 = k;
  var desc = Object.getOwnPropertyDescriptor(m, k);
  if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
    desc = { enumerable: true, get: function() {
      return m[k];
    } };
  }
  Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
  if (k2 === void 0) k2 = k;
  o[k2] = m[k];
}));
var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
  Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
  o["default"] = v;
});
var __importStar = exports && exports.__importStar || /* @__PURE__ */ (function() {
  var ownKeys = function(o) {
    ownKeys = Object.getOwnPropertyNames || function(o2) {
      var ar = [];
      for (var k in o2) if (Object.prototype.hasOwnProperty.call(o2, k)) ar[ar.length] = k;
      return ar;
    };
    return ownKeys(o);
  };
  return function(mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) {
      for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
    }
    __setModuleDefault(result, mod);
    return result;
  };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.processHookEvent = processHookEvent;
exports.detectValidationCommand = detectValidationCommand;
exports.runHookCli = runHookCli;
var child_process_1 = require("child_process");
var fs = __importStar(require("fs"));
var path = __importStar(require("path"));
var shadowRepo_1 = require_shadowRepo();
var storage_1 = require_storage();
var transcript_1 = require_transcript();
async function processHookEvent(payload) {
  const root = resolveRoot(payload);
  if (!root || !payload.hook_event_name) {
    return;
  }
  switch (payload.hook_event_name) {
    case "UserPromptSubmit":
      await onPrompt(root, payload);
      break;
    case "PostToolUse":
      await onTool(root, payload);
      break;
    case "Stop":
      await onStop(root, payload);
      break;
    default:
      break;
  }
}
async function onPrompt(root, payload) {
  const prompt = (0, storage_1.clipText)(payload.prompt, 4e3);
  const host = hostFor(payload);
  const sessionId = scopedSessionId(host, payload.session_id);
  if (!prompt) {
    return;
  }
  const config = await (0, storage_1.readProjectConfig)(root);
  const shadow = new shadowRepo_1.ShadowRepo(root, config.maxFileSizeMB);
  await (0, storage_1.mutateProjectState)(root, async (state) => {
    let parent = (0, storage_1.latestNodeOnBranch)(state);
    const preId = (0, storage_1.createId)(`pending-${safePart(sessionId)}`);
    const preSnapshot = await shadow.capture(preId, `Before: ${(0, storage_1.clip)(prompt, 80)}`, parent?.snapshotAfter);
    if (!parent) {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const initialNode = {
        id: (0, storage_1.createId)("initial"),
        kind: "manual",
        sessionId: "initial",
        sourceHost: host,
        branchId: state.activeBranchId,
        prompt: "\u521D\u59CB\u72B6\u6001",
        startedAt: now,
        completedAt: now,
        snapshotBefore: preSnapshot.commit,
        snapshotAfter: preSnapshot.commit,
        files: [],
        actions: [],
        validation: { status: "skipped" }
      };
      state.nodes.push(initialNode);
      parent = initialNode;
    } else if (preSnapshot.changed) {
      const manualId = (0, storage_1.createId)("manual");
      const files = await shadow.diffFiles(parent.snapshotAfter, preSnapshot.commit);
      const manualNode = {
        id: manualId,
        kind: "manual",
        sessionId,
        sourceHost: host,
        branchId: state.activeBranchId,
        parentId: parent.id,
        prompt: "Manual changes",
        startedAt: (/* @__PURE__ */ new Date()).toISOString(),
        completedAt: (/* @__PURE__ */ new Date()).toISOString(),
        snapshotBefore: parent.snapshotAfter,
        snapshotAfter: preSnapshot.commit,
        files,
        actions: [],
        validation: { status: "skipped" }
      };
      state.nodes.push(manualNode);
      parent = manualNode;
    }
    const pending = {
      sessionId,
      sourceHost: host,
      branchId: state.activeBranchId,
      parentId: parent?.id,
      prompt,
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      snapshotBefore: preSnapshot.commit,
      actions: []
    };
    state.pending[sessionId] = pending;
  });
}
async function onTool(root, payload) {
  const sessionId = scopedSessionId(hostFor(payload), payload.session_id);
  await (0, storage_1.mutateProjectState)(root, (state) => {
    const pending = state.pending[sessionId];
    if (!pending) {
      return;
    }
    pending.actions.push(toAction(payload));
  });
}
async function onStop(root, payload) {
  const host = hostFor(payload);
  const sessionId = scopedSessionId(host, payload.session_id);
  const response = (0, storage_1.clipText)(payload.last_assistant_message || await (0, transcript_1.readLastAssistantMessage)(payload.transcript_path), 4e3);
  const config = await ensureValidationConfig(root);
  const shadow = new shadowRepo_1.ShadowRepo(root, config.maxFileSizeMB);
  const nodeId = (0, storage_1.createId)("turn");
  let foundPending = false;
  let captureError;
  let files = [];
  let recorded = false;
  await (0, storage_1.mutateProjectState)(root, async (state) => {
    const pending = state.pending[sessionId];
    if (!pending) {
      return;
    }
    foundPending = true;
    try {
      const snapshot = await shadow.capture(nodeId, `${hostLabel(host)}: ${(0, storage_1.clip)(pending.prompt, 80)}`, pending.snapshotBefore);
      files = await shadow.diffFiles(pending.snapshotBefore, snapshot.commit);
      const node = {
        id: nodeId,
        kind: "turn",
        sessionId,
        sourceHost: host,
        branchId: pending.branchId,
        parentId: pending.parentId,
        prompt: pending.prompt,
        response,
        startedAt: pending.startedAt,
        completedAt: (/* @__PURE__ */ new Date()).toISOString(),
        snapshotBefore: pending.snapshotBefore,
        snapshotAfter: snapshot.commit,
        files,
        actions: pending.actions,
        validation: files.length > 0 ? { command: config.validationCommand, status: "running" } : { command: config.validationCommand, status: "skipped" }
      };
      state.nodes.push(node);
      delete state.pending[sessionId];
      recorded = true;
    } catch (error) {
      captureError = error;
      state.nodes.push({
        id: nodeId,
        kind: "turn",
        sessionId,
        sourceHost: host,
        branchId: pending.branchId,
        parentId: pending.parentId,
        prompt: pending.prompt,
        response,
        startedAt: pending.startedAt,
        completedAt: (/* @__PURE__ */ new Date()).toISOString(),
        snapshotBefore: pending.snapshotBefore,
        snapshotAfter: pending.snapshotBefore,
        files: [],
        actions: pending.actions,
        validation: {
          command: config.validationCommand,
          status: "failed",
          summary: `\u672C\u8F6E\u8BB0\u5F55\u5931\u8D25\uFF0C\u6587\u4EF6\u53D8\u5316\u672A\u5F52\u6863\uFF1A${String(error)}`
        }
      });
      delete state.pending[sessionId];
    }
  });
  if (!foundPending) {
    return;
  }
  if (captureError) {
    throw captureError;
  }
  try {
    const validation = await validateTurn(root, config, files.length > 0);
    await (0, storage_1.mutateProjectState)(root, (state) => {
      const current = state.nodes.find((item) => item.id === nodeId);
      if (current) {
        current.validation = validation;
      }
    });
  } catch (error) {
    if (recorded) {
      await (0, storage_1.mutateProjectState)(root, (state) => {
        const current = state.nodes.find((item) => item.id === nodeId);
        if (current) {
          current.validation = {
            command: config.validationCommand,
            status: "failed",
            summary: `\u9A8C\u8BC1\u672A\u5B8C\u6210\uFF1A${String(error)}`
          };
        }
      }).catch(() => void 0);
    }
    throw error;
  }
}
async function ensureValidationConfig(root) {
  const config = await (0, storage_1.readProjectConfig)(root);
  if (config.validationCommand !== void 0) {
    return config;
  }
  config.validationCommand = await detectValidationCommand(root);
  await (0, storage_1.writeProjectConfig)(root, config);
  return config;
}
async function detectValidationCommand(root) {
  try {
    const pkg = JSON.parse(await fs.promises.readFile(path.join(root, "package.json"), "utf8"));
    const scripts = pkg.scripts || {};
    if (scripts.test && !/no test specified|exit 1/i.test(scripts.test)) {
      return "npm test";
    }
    for (const name of ["typecheck", "build", "lint"]) {
      if (scripts[name]) {
        return `npm run ${name}`;
      }
    }
  } catch {
  }
  if (fs.existsSync(path.join(root, "pyproject.toml"))) {
    return "pytest";
  }
  if (fs.existsSync(path.join(root, "Cargo.toml"))) {
    return "cargo check";
  }
  return void 0;
}
async function validateTurn(root, config, changed) {
  if (!changed) {
    return { command: config.validationCommand, status: "skipped" };
  }
  if (!config.validationCommand) {
    return { status: "not-configured" };
  }
  const started = Date.now();
  return new Promise((resolve) => {
    (0, child_process_1.exec)(config.validationCommand, {
      cwd: root,
      timeout: config.validationTimeoutSeconds * 1e3,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, CI: "1" }
    }, (error, stdout, stderr) => {
      const durationMs = Date.now() - started;
      const summary = summarizeCommandOutput(`${stdout}
${stderr}`);
      if (!error) {
        resolve({
          command: config.validationCommand,
          status: "passed",
          exitCode: 0,
          durationMs,
          summary
        });
        return;
      }
      const timedOut = error.killed || error.code === "ETIMEDOUT";
      resolve({
        command: config.validationCommand,
        status: timedOut ? "timeout" : "failed",
        exitCode: typeof error.code === "number" ? error.code : void 0,
        durationMs,
        summary
      });
    });
  });
}
function toAction(payload) {
  const tool = payload.tool_name || payload.llm_tool_name || "Unknown";
  const input = payload.tool_input || {};
  const candidatePath = [
    input.file_path,
    input.path,
    input.target_file,
    input.filename
  ].find((value) => typeof value === "string");
  const command = typeof input.command === "string" ? input.command : typeof input.cmd === "string" ? input.cmd : void 0;
  const responseText = JSON.stringify(payload.tool_response || "");
  return {
    id: payload.tool_use_id,
    kind: tool === "Write" ? "write" : tool === "Edit" || tool === "apply_patch" ? "edit" : tool === "RunCommand" || tool === "Bash" ? "run" : "other",
    tool,
    path: candidatePath ? (0, storage_1.clip)(candidatePath, 300) : void 0,
    detail: command ? (0, storage_1.clip)(command, 300) : void 0,
    ok: !/"error"|"failed"|exception/i.test(responseText)
  };
}
function hostFor(payload) {
  const explicit = payload.wayfinder_host || process.env.WAYFINDER_HOST;
  return explicit === "claude" || explicit === "codex" ? explicit : "trae";
}
function scopedSessionId(host, sessionId) {
  const raw = sessionId || "unknown";
  return host === "trae" ? raw : `${host}:${raw}`;
}
function hostLabel(host) {
  return host === "claude" ? "Claude" : host === "codex" ? "Codex" : "TRAE";
}
function resolveRoot(payload) {
  const cwd = payload.cwd ? (0, storage_1.normalizeRoot)(payload.cwd) : void 0;
  const roots = (payload.workspace_roots || []).filter((root) => fs.existsSync(root)).map(storage_1.normalizeRoot);
  const candidate = roots.find((root) => cwd === root || Boolean(cwd?.startsWith(`${root}${path.sep}`))) || roots[0] || cwd;
  if (!candidate || !fs.existsSync(candidate)) {
    return void 0;
  }
  return (0, storage_1.normalizeRoot)(candidate);
}
function summarizeCommandOutput(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return void 0;
  }
  return (0, storage_1.clipText)(lines.slice(-6).join("\n"), 1e3);
}
function safePart(value) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function runHookCli(requestedHost) {
  let root = process.env.WAYFINDER_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.env.TRAE_PROJECT_DIR || process.cwd();
  const hookStartedAt = Date.now();
  try {
    const raw = await readStdin();
    if (!raw.trim()) {
      return;
    }
    const payload = JSON.parse(raw);
    if (requestedHost) {
      payload.wayfinder_host = requestedHost;
    }
    const hostIndex = process.argv.indexOf("--host");
    if (hostIndex >= 0) {
      const requested = process.argv[hostIndex + 1];
      if (requested === "trae" || requested === "claude" || requested === "codex") {
        payload.wayfinder_host = requested;
      }
    }
    root = resolveRoot(payload) || root;
    const before = payload.hook_event_name === "Stop" ? (await (0, storage_1.readProjectState)(root))?.nodes.length || 0 : void 0;
    await processHookEvent(payload);
    if (before !== void 0) {
      const after = await (0, storage_1.readProjectState)(root);
      if ((after?.nodes.length || 0) > before) {
        const successLog = path.join((0, storage_1.projectDataDir)(root), "hook-success.log");
        await fs.promises.mkdir(path.dirname(successLog), { recursive: true });
        await fs.promises.appendFile(successLog, `${hookStartedAt}
`, "utf8");
      }
    }
  } catch (error) {
    const log = path.join((0, storage_1.projectDataDir)(root), "hook-errors.log");
    await fs.promises.mkdir(path.dirname(log), { recursive: true });
    await fs.promises.appendFile(log, `${(/* @__PURE__ */ new Date()).toISOString()} ${String(error)}
`, "utf8").catch(() => void 0);
  }
}
if (require.main === module) {
  void runHookCli();
}

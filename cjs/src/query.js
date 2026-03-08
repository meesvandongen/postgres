const originCache = new Map()
    , originStackCache = new Map()
    , originError = Symbol('OriginError')
  , noop = () => {}

const CLOSE = module.exports.CLOSE = {}
const Query = module.exports.Query = class Query extends Promise {
  constructor(strings, args, handler, canceller, options = {}) {
    let resolve
      , reject

    super((a, b) => {
      resolve = a
      reject = b
    })

    this.tagged = Array.isArray(strings.raw)
    this.strings = strings
    this.args = args
    this.handler = handler
    this.canceller = canceller
    this.options = options

    this.state = null
    this.statement = null

    this.resolve = x => (this.active = false, resolve(x))
    this.reject = x => (this.active = false, reject(x))

    this.active = false
    this.cancelled = null
    this.executed = false
    this.signature = ''

    this[originError] = this.handler.debug
      ? new Error()
      : this.tagged && cachedError(this.strings)
  }

  get origin() {
    return (this.handler.debug
      ? this[originError].stack
      : this.tagged && originStackCache.has(this.strings)
        ? originStackCache.get(this.strings)
        : originStackCache.set(this.strings, this[originError].stack).get(this.strings)
    ) || ''
  }

  static get [Symbol.species]() {
    return Promise
  }

  cancel() {
    return this.canceller && (this.canceller(this), this.canceller = null)
  }

  simple() {
    this.options.simple = true
    this.options.prepare = false
    return this
  }

  async readable() {
    this.simple()
    this.streaming = true
    return this
  }

  async writable() {
    this.simple()
    this.streaming = true
    return this
  }

  cursor(rows = 1, fn) {
    this.options.simple = false
    if (typeof rows === 'function') {
      fn = rows
      rows = 1
    }

    this.cursorRows = rows

    if (typeof fn === 'function')
      return (this.cursorFn = fn, this)

    let prev
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          if (this.executed && !this.active)
            return { done: true }

          prev && prev()
          const promise = new Promise((resolve, reject) => {
            this.cursorFn = value => {
              resolve({ value, done: false })
              return new Promise(r => prev = r)
            }
            this.resolve = () => (this.active = false, resolve({ done: true }))
            this.reject = x => (this.active = false, reject(x))
          })
          this.execute()
          return promise
        },
        return() {
          prev && prev(CLOSE)
          return { done: true }
        }
      })
    }
  }

  describe() {
    this.options.simple = false
    this.onlyDescribe = this.options.prepare = true
    return this
  }

  stream(fn) {
    this.options.simple = false

    if (typeof fn === 'function') {
      const resolve = this.resolve
          , reject = this.reject

      let resume = null
        , queue = []
        , finalValue
        , busy = false
        , done = false
        , settled = false

      const fail = err => {
        if (settled)
          return

        done = settled = true
        queue = []
        resume && (resume(), resume = null)
        reject(err)
        Promise.resolve(this.cancel()).catch(noop)
      }

      const drain = () => {
        if (settled || busy)
          return

        while (queue.length) {
          const x = queue.shift()

          try {
            const pending = fn(x.row, x.result)
            if (pending && typeof pending.then === 'function') {
              busy = true
              return pending.then(() => {
                busy = false
                drain()
              }, fail)
            }
          } catch (err) {
            return fail(err)
          }
        }

        if (done)
          return settled || (
            resume && (resume(), resume = null),
            settled = true,
            resolve(finalValue)
          )

        resume && (resume(), resume = null)
      }

      this.streamFn = (row, result, resumeFn) => {
        if (settled)
          return false

        resume = resumeFn

        if (busy || queue.length) {
          queue.push({ row, result })
          return false
        }

        try {
          const pending = fn(row, result)
          if (pending && typeof pending.then === 'function') {
            busy = true
            pending.then(() => {
              busy = false
              drain()
            }, fail)
            return false
          }
          return true
        } catch (err) {
          fail(err)
          return false
        }
      }

      this.resolve = x => {
        this.active = false
        done = true
        finalValue = x
        drain()
      }

      this.reject = x => {
        this.active = false
        fail(x)
      }

      this.handle()
      return this
    }

    return {
      [Symbol.asyncIterator]: () => {
        const query = this
        let resume = null
          , rows = []
          , error = null
          , done = false
          , cancelled = false
          , resolver = null

        this.streamFn = (row, result, resumeFn) => {
          if (cancelled)
            return true

          if (resolver) {
            const x = resolver
            resolver = null
            x.resolve({ value: row, done: false })
            return true
          }

          rows.push(row)
          resume = resumeFn
          return false
        }

        this.resolve = () => {
          this.active = false
          done = true
          if (resolver && rows.length === 0) {
            const x = resolver
            resolver = null
            x.resolve({ value: undefined, done: true })
          }
        }

        this.reject = err => {
          this.active = false

          if (cancelled && err && err.code === '57014') {
            done = true
            if (resolver && rows.length === 0) {
              const x = resolver
              resolver = null
              x.resolve({ value: undefined, done: true })
            }
            return
          }

          error = err
          if (resolver && rows.length === 0) {
            const x = resolver
            resolver = null
            x.reject(err)
          }
        }

        this.execute()

        return {
          [Symbol.asyncIterator]() {
            return this
          },
          next: () => {
            if (rows.length) {
              const value = rows.shift()
              rows.length === 0 && resume && (resume(), resume = null)
              return Promise.resolve({ value, done: false })
            }

            if (error)
              return Promise.reject(error)

            if (done)
              return Promise.resolve({ value: undefined, done: true })

            return new Promise((resolve, reject) => {
              resolver = { resolve, reject }
            })
          },
          return: async() => {
            cancelled = true
            done = true
            rows = []
            resume && (resume(), resume = null)
            resolver && (resolver.resolve({ value: undefined, done: true }), resolver = null)
            Promise.resolve(query.cancel()).catch(noop)
            return { value: undefined, done: true }
          }
        }
      }
    }
  }

  forEach(fn) {
    this.forEachFn = fn
    this.handle()
    return this
  }

  raw() {
    this.isRaw = true
    return this
  }

  values() {
    this.isRaw = 'values'
    return this
  }

  async handle() {
    !this.executed && (this.executed = true) && await 1 && this.handler(this)
  }

  execute() {
    this.handle()
    return this
  }

  then() {
    this.handle()
    return super.then.apply(this, arguments)
  }

  catch() {
    this.handle()
    return super.catch.apply(this, arguments)
  }

  finally() {
    this.handle()
    return super.finally.apply(this, arguments)
  }
}

function cachedError(xs) {
  if (originCache.has(xs))
    return originCache.get(xs)

  const x = Error.stackTraceLimit
  Error.stackTraceLimit = 4
  originCache.set(xs, new Error())
  Error.stackTraceLimit = x
  return originCache.get(xs)
}

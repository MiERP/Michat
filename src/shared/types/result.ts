/**
 * Unified error handling types
 * Replaces the mixed use of throw Error and returned error objects
 */

/**
 * Result type - represents the success or failure of an operation
 * @template T - Data type on success
 * @template E - Error type on failure, defaults to Error
 */
export type Result<T, E = Error> = { success: true; data: T } | { success: false; error: E }

/**
 * Create a successful Result
 * @param data - The success data
 * @returns A successful Result object
 * @example
 * const result = Ok({ id: '123', name: 'test' })
 * // result = { success: true, data: { id: '123', name: 'test' } }
 */
export function Ok<T>(data: T): Result<T, never> {
  return { success: true, data }
}

/**
 * Create a failed Result
 * @param error - Error object or error message
 * @returns A failed Result object
 * @example
 * const result = Err(new Error('Something went wrong'))
 * // result = { success: false, error: Error('Something went wrong') }
 *
 * const result2 = Err('Invalid input')
 * // result2 = { success: false, error: Error('Invalid input') }
 */
export function Err<E = Error>(error: E | string): Result<never, E> {
  const errorObj = typeof error === 'string' ? (new Error(error) as E) : error
  return { success: false, error: errorObj }
}

/**
 * Check whether a Result is successful
 * @param result - Result object
 * @returns true if successful
 */
export function isOk<T, E>(result: Result<T, E>): result is { success: true; data: T } {
  return result.success === true
}

/**
 * Check whether a Result is a failure
 * @param result - Result object
 * @returns true if failed
 */
export function isErr<T, E>(result: Result<T, E>): result is { success: false; error: E } {
  return result.success === false
}

/**
 * Extract data from a Result, throwing if it failed
 * @param result - Result object
 * @returns The success data
 * @throws If the Result is in a failed state
 * @example
 * const result = Ok(42)
 * const value = unwrap(result) // value = 42
 *
 * const failResult = Err('Failed')
 * const value2 = unwrap(failResult) // throws Error('Failed')
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.success) {
    return result.data
  }
  throw result.error
}

/**
 * Extract data from a Result, returning a default value if it failed
 * @param result - Result object
 * @param defaultValue - Default value on failure
 * @returns The success data or the default value
 * @example
 * const result = Ok(42)
 * const value = unwrapOr(result, 0) // value = 42
 *
 * const failResult = Err('Failed')
 * const value2 = unwrapOr(failResult, 0) // value2 = 0
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (result.success) {
    return result.data
  }
  return defaultValue
}

/**
 * Wrap an async function so it returns a Result
 * @param fn - Async function
 * @returns An async function returning a Result
 * @example
 * const safeFetch = wrapAsync(async (url: string) => {
 *   const response = await fetch(url)
 *   return response.json()
 * })
 *
 * const result = await safeFetch('https://api.example.com/data')
 * if (result.success) {
 *   console.log(result.data)
 * } else {
 *   console.error(result.error)
 * }
 */
export function wrapAsync<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>
): (...args: T) => Promise<Result<R>> {
  return async (...args: T) => {
    try {
      const data = await fn(...args)
      return Ok(data)
    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

/**
 * Wrap a sync function so it returns a Result
 * @param fn - Sync function
 * @returns A function returning a Result
 * @example
 * const safeParseInt = wrapSync((str: string) => {
 *   const num = parseInt(str, 10)
 *   if (isNaN(num)) throw new Error('Invalid number')
 *   return num
 * })
 *
 * const result = safeParseInt('42')  // { success: true, data: 42 }
 * const result2 = safeParseInt('abc') // { success: false, error: Error('Invalid number') }
 */
export function wrapSync<T extends unknown[], R>(fn: (...args: T) => R): (...args: T) => Result<R> {
  return (...args: T) => {
    try {
      const data = fn(...args)
      return Ok(data)
    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

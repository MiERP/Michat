declare module 'xlsx'
declare module 'exceljs'

declare module 'ipaddr.js' {
  export interface IPv4 {
    kind(): 'ipv4'
    range(): string
    toString(): string
  }
  export interface IPv6 {
    kind(): 'ipv6'
    range(): string
    isIPv4MappedAddress(): boolean
    toIPv4Address(): IPv4
    toString(): string
  }
  export type IP = IPv4 | IPv6
  export function isValid(input: string): boolean
  export function parse(input: string): IP
  export function process(input: string): IP
}

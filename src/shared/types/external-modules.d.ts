declare module 'xlsx'
declare module 'docxtemplater'
declare module 'pizzip'
declare module 'exceljs'

declare module 'officeparser' {
  function parseOfficeAsync(buffer: Buffer): Promise<string>
  export default parseOfficeAsync
}

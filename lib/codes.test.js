const { getManufacturerCode, getManufacturerName } = require('./codes')

describe('getManufacturerCode', () => {
  test('Return mfg number from name string', () => {
    expect(getManufacturerCode('Furuno')).toBe(1855)
    expect(getManufacturerCode('Yacht Devices')).toBe(717)
    expect(getManufacturerCode('TJC Micro')).toBe(963)
  })
})

describe('getManufacturerName', () => {
  test('Return name string from mfg number', () => {
    expect(getManufacturerName(1855)).toBe('Furuno')
    expect(getManufacturerName(717)).toBe('Yacht Devices')
    expect(getManufacturerName(963)).toBe('TJC Micro')
  })
})

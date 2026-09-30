import { supportsMobileSync } from '../src/utils/host-version'

test.each([
  '3.2.14-pre.3',
  'v3.2.14-pre.10',
  '3.2.14',
  '3.2.15-pre.1',
  '4.0.0',
  '3.2.14+build.7',
])('enables replay for connected Host %s', version => {
  expect(supportsMobileSync(version)).toBe(true)
})
test.each([
  null,
  undefined,
  '',
  '0.0.1-dev',
  '3.2.13',
  '3.2.14-pre.2',
  '3.2.14-dev',
  'garbage',
])('preserves the old path for %s', version => {
  expect(supportsMobileSync(version)).toBe(false)
})

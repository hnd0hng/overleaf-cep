import { expect } from 'chai'
import { nextMatchIndex } from '@/features/visual-table-editor/find-replace'

describe('Visual Table Editor find and replace', function () {
  it('starts Next at the first match and Previous at the last match', function () {
    expect(nextMatchIndex(-1, 3, 1)).to.equal(0)
    expect(nextMatchIndex(-1, 3, -1)).to.equal(2)
  })

  it('wraps in both directions and rejects an empty result set', function () {
    expect(nextMatchIndex(2, 3, 1)).to.equal(0)
    expect(nextMatchIndex(0, 3, -1)).to.equal(2)
    expect(nextMatchIndex(0, 0, 1)).to.equal(-1)
  })

  it('recovers from a stale current index after results change', function () {
    expect(nextMatchIndex(4, 1, 1)).to.equal(0)
    expect(nextMatchIndex(4, 1, -1)).to.equal(0)
  })
})

import { expect } from 'chai'
import sinon from 'sinon'
import { copyText } from '@/features/visual-table-editor/clipboard'

describe('Visual Table Editor clipboard', function () {
  afterEach(function () {
    sinon.restore()
    delete (
      document as unknown as {
        execCommand?: (command: string) => boolean
      }
    ).execCommand
  })

  it('uses the Clipboard API when it is available', async function () {
    const writeText = sinon.stub().resolves()

    expect(await copyText('masked source', { writeText }, document)).to.equal(
      true
    )
    expect(writeText).to.have.been.calledOnceWith('masked source')
  })

  it('falls back to a temporary textarea in an insecure context', async function () {
    const execCommand = sinon.stub().returns(true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    })

    expect(await copyText('masked source', undefined, document)).to.equal(true)
    expect(execCommand).to.have.been.calledOnceWith('copy')
    expect(document.querySelector('textarea[readonly]')).to.equal(null)
  })

  it('reports failure and removes the temporary textarea', async function () {
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: sinon.stub().throws(new Error('copy denied')),
    })

    expect(await copyText('masked source', undefined, document)).to.equal(false)
    expect(document.querySelector('textarea[readonly]')).to.equal(null)
  })
})

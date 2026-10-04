import { expect } from 'chai'
import sinon from 'sinon'
import { act, render, renderHook, screen } from '@testing-library/react'
import VisualTableReorderNotice from '@/features/visual-table-editor/components/visual-table-reorder-notice'
import useTransientNotice, {
  REORDER_NOTICE_DURATION,
} from '@/features/visual-table-editor/hooks/use-transient-notice'

describe('Visual Table Editor transient reorder notice', function () {
  let clock: sinon.SinonFakeTimers

  beforeEach(function () {
    clock = sinon.useFakeTimers()
  })

  afterEach(function () {
    clock.restore()
  })

  it('uses the Overleaf notification style and announces the reason', function () {
    render(<VisualTableReorderNotice message="This move is not available." />)

    const notice = screen.getByRole('alert')
    expect(notice.classList.contains('notification-ds')).to.equal(true)
    expect(notice.classList.contains('vte-reorder-notice')).to.equal(true)
    expect(notice.textContent).to.contain('This move is not available.')
  })

  it('hides after the configured duration and restarts for a new message', function () {
    const { result, unmount } = renderHook(() => useTransientNotice())

    act(() => result.current.showNotice('First reason'))
    expect(result.current.notice?.message).to.equal('First reason')

    act(() => clock.tick(REORDER_NOTICE_DURATION - 500))
    act(() => result.current.showNotice('Second reason'))
    const secondId = result.current.notice?.id

    act(() => clock.tick(600))
    expect(result.current.notice).to.deep.equal({
      id: secondId,
      message: 'Second reason',
    })

    act(() => clock.tick(REORDER_NOTICE_DURATION - 600))
    expect(result.current.notice).to.equal(null)

    act(() => result.current.showNotice('Pending reason'))
    unmount()
    expect(clock.countTimers()).to.equal(0)
  })
})

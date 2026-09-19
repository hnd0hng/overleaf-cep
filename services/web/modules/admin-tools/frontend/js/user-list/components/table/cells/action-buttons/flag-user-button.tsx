import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import useIsMounted from '@/shared/hooks/use-is-mounted'
import { useUserListContext } from '../../../../context/user-list-context'
import { User } from '../../../../../../../types/user/api'
import FlagUserModal from '../../../modals/flag-user-modal'
import { performUpdateUser, PostActions } from '../../../../util/user-actions'

type FlagUserButtonProps = {
  user: User
  action: 'set_admin' | 'unset_admin' | 'suspend' | 'resume'
  children: (text: string, handleOpenModal: () => void) => React.ReactElement
}

function FlagUserButton({ user, action, children }: FlagUserButtonProps) {
  const { t } = useTranslation()
  const [showModal, setShowModal] = useState(false)
  const isMounted = useIsMounted()
  const text = t(action)

  const handleOpenModal = useCallback(() => {
    setShowModal(true)
  }, [])

  const handleCloseModal = useCallback(() => {
    if (isMounted.current) {
      setShowModal(false)
    }
  }, [isMounted])

  const { toggleSelectedUser, updateUserViewData } = useUserListContext()
  const postActions: PostActions = { toggleSelectedUser, updateUserViewData }
  const handleFlagUser = useCallback(
    (user: User, options: any) => {
      return performUpdateUser(user, postActions, options)
    },
    [postActions]
  )

  if (user.deleted) return null
  if (action === 'suspend' && user.suspended) return null
  if (action === 'resume' && !user.suspended) return null

  return (
    <>
      {children(text, handleOpenModal)}
      {showModal && (
        <FlagUserModal
          users={[user]}
          action={action}
          actionHandler={handleFlagUser}
          showModal={showModal}
          handleCloseModal={handleCloseModal}
        />
      )}
    </>
  )
}

const FlagUserButtonTooltip = memo(function FlagUserButtonTooltip({
  user,
  flag,
}: {
  user: User
  flag: 'isAdmin' | 'suspended'
}) {
  let action: FlagUserButtonProps['action']
  let icon
  switch (flag) {
    case 'isAdmin':
      action = user.isAdmin ? 'unset_admin' : 'set_admin'
      icon = user.isAdmin ? 'remove_moderator' : 'add_moderator'
      break
    case 'suspended':
      action = user.suspended ? 'resume' : 'suspend'
      icon = user.suspended ? 'resume' : 'pause'
      break
    default:
      return null
  }

  return (
    <FlagUserButton user={user} action={action}>
      {(text, handleOpenModal) => (
        <OLTooltip
          key={`tooltip-${action}-user-${user.id}`}
          id={`${action}-user-${user.id}`}
          description={text}
          overlayProps={{ placement: 'top', trigger: ['hover', 'focus'] }}
        >
          <OLIconButton
            onClick={handleOpenModal}
            variant="link"
            accessibilityLabel={text}
            className="action-btn"
            icon={icon}
          />
        </OLTooltip>
      )}
    </FlagUserButton>
  )
})

export default memo(FlagUserButton)
export { FlagUserButtonTooltip }

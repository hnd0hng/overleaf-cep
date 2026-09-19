type NamedUser = {
  firstName?: string
  lastName?: string
  email?: string
}

export function getUserName(user?: NamedUser | null) {
  if (!user) return '[N/A]'

  const { firstName, lastName, email } = user
  if (firstName || lastName) {
    return [firstName, lastName].filter(n => n != null).join(' ')
  }
  if (email) {
    return email
  }

  return '[Noname]'
}

export function keepUserOnSessionHydrationError(currentUser, sessionUserId) {
  return currentUser?.id === sessionUserId ? currentUser : null
}

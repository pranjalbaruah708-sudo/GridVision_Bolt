let authorizedUserId: string | null = null;

export function setQueueSyncAuthorization(userId: string | null): void {
  authorizedUserId = userId;
}

export function isQueueSyncAuthorized(userId: string): boolean {
  return Boolean(userId) && authorizedUserId === userId;
}

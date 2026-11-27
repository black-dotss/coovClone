export interface UserProfile {
  id: string;
  userId: string;
  displayName: string;
  timezone: string;
  accountStatus: "active" | "suspended" | "pending_deletion";
  createdAt: Date;
  updatedAt: Date;
}

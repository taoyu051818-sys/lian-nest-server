export class CurrentUserDto {
  id!: number;
  uuid!: string;
  email!: string;
  username!: string;
  displayName!: string | null;
  avatarUrl!: string | null;
  role!: 'USER' | 'MODERATOR' | 'ADMIN';
  nodebbUid!: number | null;
  createdAt!: string;
}

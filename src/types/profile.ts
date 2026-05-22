export interface Profile {
  id: string;
  email: string;
  approved: boolean;
  role: 'admin' | 'member';
  created_at: string;
}

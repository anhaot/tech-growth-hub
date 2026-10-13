import type { User } from '../types/index.js';

export function serializeUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    must_change_password: user.must_change_password,
    user_type: user.user_type,
    library_owner_id: user.library_owner_id,
    category_scopes: user.category_scopes,
    permissions: user.permissions,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

/** Profile wall shapes (migration 0292). Pure: client and server import it. */

export const POST_MAX = 2000;
export const COMMENT_MAX = 1000;

/** One row of get_wall: only what this viewer may see. */
export type WallPost = {
  id: string;
  author_id: string;
  /** Null when the author hides their handle and the viewer isn't their friend. */
  author_username: string | null;
  author_avatar_url: string | null;
  body: string;
  photo_url: string | null;
  /** Only returned to the wall owner; null = follows the wall's audience. */
  audience: string | null;
  created_at: string;
  comment_count: number;
  can_delete: boolean;
};

export type WallComment = {
  id: string;
  author_id: string;
  author_username: string | null;
  author_avatar_url: string | null;
  body: string;
  created_at: string;
  can_delete: boolean;
};

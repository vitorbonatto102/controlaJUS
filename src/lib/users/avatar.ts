export const USER_AVATAR_BUCKET = "user-avatars";
export const USER_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const USER_AVATAR_ACCEPT = "image/png,image/jpeg,image/webp";
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const avatarPathPattern = new RegExp(`^(${uuid})/(${uuid})/${uuid}\\.(png|jpg|webp)$`);

export function isUserAvatarPath(path: string, officeId: string, userId: string): boolean {
  const match = avatarPathPattern.exec(path);
  return !!match && match[1] === officeId && match[2] === userId;
}

export function userInitials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => Array.from(part)[0]).join("").toLocaleUpperCase("pt-BR") || "U";
}

import { revalidatePath } from "next/cache";

/**
 * revalidatePath throws when called outside a request/render context (e.g. from
 * a maintenance script or test). In-app mutations always have that context, so
 * this is purely defensive.
 */
export function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // No static generation store available — nothing to invalidate.
  }
}

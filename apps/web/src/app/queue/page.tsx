import { permanentRedirect } from "next/navigation";

/**
 * The old address for the same list.
 *
 * "My queue" became "Assigned to me" and moved to `/assigned`. Leaving the
 * original route rendering its own copy meant two pages showing one thing,
 * drifting apart from the moment one of them was next edited — and the nav
 * pointed at only one of them, so the other was reachable solely from links
 * people had already sent each other.
 *
 * A permanent redirect rather than a deletion: those links exist.
 */
export default function QueuePage(): never {
  permanentRedirect("/assigned");
}

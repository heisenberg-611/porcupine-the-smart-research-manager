import { PageSkeleton } from "@/components/ui";

/** The default pending state, inherited by any segment without its own. */
export default function Loading() {
  return <PageSkeleton shape="list" />;
}

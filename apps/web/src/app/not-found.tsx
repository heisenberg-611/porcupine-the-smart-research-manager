import { ButtonLink, EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-12">
      <EmptyState
        title="Page not found"
        description="The page you are looking for does not exist, or you don't have access to it."
        action={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/dashboard" variant="primary">
              Go to Dashboard
            </ButtonLink>
          </div>
        }
      />
    </main>
  );
}

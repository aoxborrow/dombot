import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';

/** A stub page for a tab whose feature hasn't been built yet. */
export default function Placeholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-[32px]">{title}</h1>
        <p className="-mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      <Empty className="rounded-lg border border-dashed">
        <EmptyHeader>
          <EmptyTitle>Coming soon</EmptyTitle>
          <EmptyDescription>
            Nothing here yet — this page is a placeholder.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

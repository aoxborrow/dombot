import { Fragment, useMemo } from 'react';
import { parseNotes, type NotesInline } from '../../shared/releases';

/**
 * A release's notes, drawn from the markdown subset parseNotes reads. The text
 * comes from the network, so it is only ever rendered as React text — no HTML.
 * Links open in the user's browser.
 */
export default function ReleaseNotes({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parseNotes(markdown), [markdown]);
  if (!blocks.length)
    return <p className="text-sm text-muted-foreground">No release notes.</p>;
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed text-foreground/85">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading':
            return (
              <h4
                key={i}
                className="mt-2 font-semibold text-foreground first:mt-0"
              >
                <Inline parts={block.content} />
              </h4>
            );
          case 'list':
            return (
              <ul key={i} className="ml-4 list-disc space-y-1">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inline parts={item} />
                  </li>
                ))}
              </ul>
            );
          case 'rule':
            return <hr key={i} className="my-1 border-border" />;
          default:
            return (
              <p key={i}>
                <Inline parts={block.content} />
              </p>
            );
        }
      })}
    </div>
  );
}

function Inline({ parts }: { parts: NotesInline[] }) {
  return (
    <>
      {parts.map((p, i) => {
        if (p.type === 'strong')
          return (
            <strong key={i} className="font-semibold text-foreground">
              {p.text}
            </strong>
          );
        if (p.type === 'code')
          return (
            <code key={i} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">
              {p.text}
            </code>
          );
        if (p.type === 'link')
          return (
            <a
              key={i}
              href={p.href}
              className="text-brand underline-offset-2 hover:underline"
              onClick={(e) => {
                e.preventDefault();
                void window.api.openExternal(p.href);
              }}
            >
              {p.text}
            </a>
          );
        return <Fragment key={i}>{p.text}</Fragment>;
      })}
    </>
  );
}

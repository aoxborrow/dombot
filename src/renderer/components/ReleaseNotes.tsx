import type { ComponentProps, ElementType, HTMLAttributes } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

/**
 * A release's notes: the GitHub release body, which is GitHub-flavored
 * markdown. react-markdown builds React elements from it and never injects
 * HTML; `skipHtml` drops any raw HTML in the source, unsafe link schemes are
 * stripped by its default URL filter, and images are left out so opening the
 * notes never loads anything remote. Links open in the user's browser.
 */
export default function ReleaseNotes({
  markdown,
  className,
}: {
  markdown: string;
  className?: string;
}) {
  if (!markdown.trim())
    return <p className="text-sm text-muted-foreground">No release notes.</p>;
  return (
    <div
      className={cn(
        'flex flex-col gap-2 text-sm leading-relaxed text-foreground/85',
        className,
      )}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={['img']}
        unwrapDisallowed
        components={COMPONENTS}
      >
        {markdown}
      </Markdown>
    </div>
  );
}

function ExternalLink({ href, children }: ComponentProps<'a'>) {
  return (
    <a
      href={href}
      className="text-brand underline-offset-2 hover:underline"
      onClick={(e) => {
        e.preventDefault();
        if (href && /^https?:\/\//.test(href))
          void window.api.openExternal(href);
      }}
    >
      {children}
    </a>
  );
}

// Plain elements styled to sit inside a settings card. react-markdown also
// passes `node` (its AST handle), which mustn't reach the DOM.
type MarkdownProps = HTMLAttributes<HTMLElement> & { node?: unknown };
function styled(Tag: ElementType, base: string) {
  return function Styled({ node, className, ...props }: MarkdownProps) {
    void node;
    return <Tag className={cn(base, className)} {...props} />;
  };
}

const COMPONENTS: Components = {
  h1: styled('h4', 'mt-2 font-semibold text-foreground first:mt-0'),
  h2: styled('h4', 'mt-2 font-semibold text-foreground first:mt-0'),
  h3: styled('h5', 'mt-1 font-medium text-foreground first:mt-0'),
  h4: styled('h5', 'mt-1 font-medium text-foreground first:mt-0'),
  ul: styled('ul', 'ml-4 list-disc space-y-1'),
  ol: styled('ol', 'ml-4 list-decimal space-y-1'),
  // GFM task lists render their own checkbox; drop the bullet for those.
  li: styled('li', '[&.task-list-item]:-ml-4 [&.task-list-item]:list-none'),
  strong: styled('strong', 'font-semibold text-foreground'),
  code: styled('code', 'rounded bg-muted px-1 py-0.5 text-[0.9em]'),
  pre: styled(
    'pre',
    'overflow-x-auto rounded bg-muted p-2 text-xs [&_code]:bg-transparent [&_code]:p-0',
  ),
  blockquote: styled('blockquote', 'border-l-2 pl-3 text-muted-foreground'),
  hr: () => <hr className="my-1 border-border" />,
  table: (props: MarkdownProps) => (
    <div className="overflow-x-auto">
      {styled('table', 'w-full border-collapse text-left text-xs')(props)}
    </div>
  ),
  th: styled('th', 'border-b px-2 py-1 font-medium'),
  td: styled('td', 'border-b border-border/50 px-2 py-1'),
  a: ({ node, ...props }: ComponentProps<'a'> & { node?: unknown }) => {
    void node;
    return <ExternalLink {...props} />;
  },
};

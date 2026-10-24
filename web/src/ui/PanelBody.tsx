import type { HTMLAttributes } from 'react';
// Legacy layout owns .panel and its header. This component is content only.
export function PanelBody(props: HTMLAttributes<HTMLDivElement>) { return <div {...props} />; }

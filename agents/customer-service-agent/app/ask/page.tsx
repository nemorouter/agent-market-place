import { AskGuruWidget } from '@/components/AskGuruWidget';
import { EmbedBridge } from '@/components/EmbedBridge';

// Transparent page mounted inside the embed iframe (one <script> on a customer
// site → this page in a bottom-right iframe). Renders the exact widget; the
// bridge tells the host iframe when to grow/shrink.
export default function AskPage() {
  return (
    <div style={{ background: 'transparent' }}>
      <AskGuruWidget />
      <EmbedBridge />
    </div>
  );
}

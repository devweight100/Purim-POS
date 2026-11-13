import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ระบบขายหน้าร้าน ร้านปุริม (Purim POS)',
    short_name: 'ปุริม POS',
    description: 'ระบบบริหารจัดการจุดขายหน้าร้านและคลังสินค้า ร้านปุริม',
    start_url: '/pos',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#4f46e5',
    // long-press the installed app icon: the owner's read-only summary for phones (start_url stays the POS)
    shortcuts: [
      {
        name: 'สรุปร้าน (มือถือ)',
        short_name: 'สรุปร้าน',
        description: 'ยอดขาย สต็อก ราคา และบิล แบบดูอย่างเดียว',
        url: '/m',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
    ],
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon.svg',
        sizes: '192x192 512x512',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}

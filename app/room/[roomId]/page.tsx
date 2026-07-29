import { redirect } from 'next/navigation';

// `params` is a Promise from Next 15 on. This is the only server component in the
// app that reads a route param — everything else is a client component using
// useParams() — so it is the whole of that migration.
export default async function RoomIndex({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  redirect(`/room/${roomId}/model`);
}

import { redirect } from 'next/navigation';

export default function RoomIndex({ params }: { params: { roomId: string } }) {
  redirect(`/room/${params.roomId}/model`);
}

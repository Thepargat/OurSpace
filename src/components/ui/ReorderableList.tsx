import { Reorder, useDragControls } from "motion/react";
import { GripVertical } from "lucide-react";
import { springs } from "../../lib/motion";
import { cn } from "../../lib/utils";

export interface ReorderItemData {
  id: string;
  content: React.ReactNode;
}

interface ReorderableListProps {
  items: ReorderItemData[];
  onReorder: (newOrder: ReorderItemData[]) => void;
  className?: string;
}

export default function ReorderableList({ items, onReorder, className }: ReorderableListProps) {
  return (
    <Reorder.Group 
      axis="y" 
      values={items} 
      onReorder={onReorder} 
      className={cn("flex w-full flex-col gap-3", className)}
    >
      {items.map((item) => (
        <ReorderableListItem key={item.id} item={item} />
      ))}
    </Reorder.Group>
  );
}

function ReorderableListItem({ item }: { item: ReorderItemData }) {
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      value={item}
      id={item.id}
      dragListener={false}
      dragControls={dragControls}
      layout
      transition={springs.soft}
      className="relative flex w-full items-center gap-3 rounded-2xl bg-parchment border border-stone p-4 shadow-sm"
    >
      <div
        className="cursor-grab touch-none text-warm-grey active:cursor-grabbing"
        onPointerDown={(e) => dragControls.start(e)}
      >
        <GripVertical size={20} />
      </div>
      <div className="flex-1">{item.content}</div>
    </Reorder.Item>
  );
}

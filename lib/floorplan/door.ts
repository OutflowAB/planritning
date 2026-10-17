import type { DoorObject } from "@/lib/floorplan/types";

type Vector = [number, number];

function rotate(degrees: number, [x, y]: Vector): Vector {
  const angle = (degrees * Math.PI) / 180;
  return [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
}

/**
 * Where the hinge sits inside the door's unrotated outline, measured from its top-left corner
 * (stroke included). A right-swinging door opens from its hinge to the right, a left-swinging one
 * to the left; either way the leaf stands up from the hinge.
 */
function hingeInOutline(door: Pick<DoorObject, "width" | "swing" | "strokeWidth">): Vector {
  const half = door.strokeWidth / 2;
  return door.swing === "right" ? [half, door.width + half] : [door.width + half, door.width + half];
}

/**
 * The same door swinging to the other side of its wall: same opening, same hinge, the leaf on the
 * far side. That is half a turn with the hinge kept in place and the swing reversed.
 */
export function flipDoorSide(door: DoorObject): Pick<DoorObject, "x" | "y" | "rotation" | "swing"> {
  const [hx, hy] = rotate(door.rotation, hingeInOutline(door));
  const hinge: Vector = [door.x + hx, door.y + hy];

  const swing = door.swing === "right" ? "left" : "right";
  const rotation = ((door.rotation + 180 + 180) % 360) - 180;
  const [cx, cy] = rotate(rotation, hingeInOutline({ ...door, swing }));
  return { x: hinge[0] - cx, y: hinge[1] - cy, rotation, swing };
}

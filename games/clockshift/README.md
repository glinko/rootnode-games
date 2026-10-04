# ClockShift

ClockShift is a static p5.js prototype of the Clockwork arrow puzzle. The
player rotates a rigid arrow around a hinge, spends a charge to reverse it,
captures neighbouring hinges at an axis crossing, or releases into free flight.
The ten JSON training levels use the schema from the implementation
specification and include enemies, spikes, bonuses, bumpers, doors, switches,
teleporters, and a flight finish.

## Controls

- **A / Reverse** changes the sign of the attached angular velocity and spends
  one charge.
- **S / Release** starts free flight with the current centre velocity and
  angular velocity.
- **D / Capture** arms the nearest orthogonal neighbour. The transfer happens
  when the rotating free end reaches that hinge axis.
- **R / Restart**, **Escape / Pause**.

Free flight has no action buttons: either end automatically captures a hinge.
Progress is stored in `localStorage` under a versioned ClockShift key.

Use **Editor** in the game footer to open the visual authoring screen. Hinge,
player, exit, enemy, enemy route, wall, bumper, door, spike, bonus, switch and
teleporter tools write the same JSON schema as the training campaign. A route
starts at an enemy hinge and is completed by pressing Enter after selecting the
next hinges. Saving keeps a local copy and also posts the level to the
same-origin ClockShift level API when the host provides it; published levels
are then shown in the game's Levels dialog.
The public editor has no account system, so anyone with access to the host can
create or update a level.

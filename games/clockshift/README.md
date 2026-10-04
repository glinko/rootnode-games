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

The first p5.js port keeps the first-prototype scope from the spec. There is no
network, account, server level database, leaderboard, or editor in this static
game package. User-created level authoring is a later stage of the specification.

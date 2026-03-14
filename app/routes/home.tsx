import type { Route } from './+types/home'
import { CycleMap } from '~/presentation/components/map/CycleMap'
import { BottomSheet } from '~/presentation/components/layout/BottomSheet'

export function meta(_: Route.MetaArgs) {
  return [
    { title: 'CycleRoute' },
    { name: 'description', content: 'Build bike-lane-first cycling routes in your city.' },
  ]
}

export default function Home() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <CycleMap />
      <BottomSheet />
    </div>
  )
}

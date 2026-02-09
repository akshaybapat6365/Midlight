import React from 'react'
import { AppHeader } from './components/AppHeader'
import { PickupDemo } from './components/PickupDemo'

function App() {
  const [health, setHealth] = React.useState(null)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader health={health} />
      <PickupDemo onHealth={setHealth} />
    </div>
  )
}

export default App

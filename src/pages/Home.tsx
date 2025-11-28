import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

export default function Home() {
  const [user, setUser] = useState<any>(null)
  const navigate = useNavigate()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate('/login')
      } else {
        setUser(session.user)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        navigate('/login')
      } else {
        setUser(session.user)
      }
    })

    return () => subscription.unsubscribe()
  }, [navigate])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-12 text-center">
        <h1 className="text-6xl font-bold text-gray-900 mb-4">Hi! 👋</h1>
        <p className="text-xl text-gray-600 mb-8">
          Welcome, {user.email}
        </p>
        <button
          onClick={handleLogout}
          className="bg-indigo-600 text-white rounded-lg px-6 py-3 font-medium hover:bg-indigo-700 transition-colors"
        >
          Logout
        </button>
      </div>
    </div>
  )
}

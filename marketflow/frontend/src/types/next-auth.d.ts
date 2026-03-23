import 'next-auth'
import 'next-auth/jwt'

declare module 'next-auth' {
  interface Session {
    user: {
      id:    string
      email: string
      plan:  'FREE' | 'PREMIUM'
      name?:  string | null
      image?: string | null
    }
  }
  interface User {
    id:   string
    plan: 'FREE' | 'PREMIUM'
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id:   string
    plan: 'FREE' | 'PREMIUM'
  }
}

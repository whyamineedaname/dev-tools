export interface Tool {
  id: string
  name: string
  icon: string
  category: string
  component: string
}

export interface Tab {
  id: string
  toolId: string
  title: string
}

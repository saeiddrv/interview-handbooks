// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
  site: 'https://interview.saeiddrv.com',
  integrations: [
    starlight({
      title: 'Interview Handbooks',
      description:
        'A free, open-source library of senior, staff, and principal level engineering interview handbooks.',
      tagline: 'Senior · Staff · Principal interview prep',
      lastUpdated: true,
      customCss: ['./src/styles/custom.css'],
      components: {
        Footer: './src/components/Footer.astro',
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/saeiddrv/interview-handbooks',
        },
        {
          icon: 'external',
          label: 'saeiddrv.com',
          href: 'https://saeiddrv.com',
        },
      ],
      editLink: {
        baseUrl:
          'https://github.com/saeiddrv/interview-handbooks/edit/main/src/content/docs/',
      },
      sidebar: [
        { label: 'Data & Storage', items: [{ autogenerate: { directory: 'data-storage' } }] },
        { label: 'Messaging & APIs', items: [{ autogenerate: { directory: 'messaging' } }] },
        { label: 'Backend', items: [{ autogenerate: { directory: 'backend' } }] },
        { label: 'Architecture & Infra', items: [{ autogenerate: { directory: 'architecture' } }] },
        { label: 'Security', items: [{ autogenerate: { directory: 'security' } }] },
        { label: 'Tooling', items: [{ autogenerate: { directory: 'tooling' } }] },
        { label: 'AI / ML', items: [{ autogenerate: { directory: 'ai-ml' } }] },
      ],
    }),
  ],
});

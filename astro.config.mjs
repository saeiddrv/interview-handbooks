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
        'A free, open-source library of senior, staff, and principal level software engineering interview handbooks.',
      tagline: 'Interview prep for software engineers · Senior · Staff · Principal',
      lastUpdated: true,
      favicon: '/favicon.svg',
      head: [
        // Social card (Open Graph + Twitter) — absolute URLs required
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://interview.saeiddrv.com/og.png' } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://interview.saeiddrv.com/og.png' } },
        // Icons & PWA
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
        { tag: 'link', attrs: { rel: 'manifest', href: '/site.webmanifest' } },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#4f46e5' } },
      ],
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
        baseUrl: 'https://github.com/saeiddrv/interview-handbooks/edit/main/',
      },
      sidebar: [
        { label: 'Data & Storage', items: ['data-storage/postgresql', 'data-storage/redis', 'data-storage/elasticsearch'] },
        { label: 'Messaging & APIs', items: ['messaging/kafka-vs-rabbitmq', 'messaging/grpc', 'messaging/api-design'] },
        { label: 'Backend', items: ['backend/spring-boot', 'backend/ktor', 'backend/hibernate-jpa', 'backend/jvm-internals', 'backend/language-tricky-points', 'backend/data-structures', 'backend/algorithms', 'backend/concurrency', 'backend/async-reactive'] },
        { label: 'Architecture & Infra', items: ['architecture/system-design', 'architecture/distributed-systems', 'architecture/microservices', 'architecture/docker', 'architecture/kubernetes', 'architecture/nginx-load-balancing'] },
        { label: 'Operations & Quality', items: ['operations/observability-sre', 'operations/cicd', 'operations/testing'] },
        { label: 'Security', items: ['security/oauth2-jwt', 'security/secure-coding'] },
        { label: 'Tooling', items: ['tooling/git'] },
        { label: 'AI / ML', items: ['ai-ml/llm-engineering'] },
        { label: 'Career & Leadership', items: ['career/staff-leadership', 'career/soft-skills'] },
      ],
    }),
  ],
});

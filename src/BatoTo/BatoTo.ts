import {
    BadgeColor,
    Chapter,
    ChapterDetails,
    ChapterProviding,
    ContentRating,
    DUISection,
    HomePageSectionsProviding,
    HomeSection,
    MangaProviding,
    PagedResults,
    Request,
    Response,
    SearchRequest,
    SearchResultsProviding,
    SourceInfo,
    SourceIntents,
    SourceManga,
    Tag,
    TagSection
} from '@paperback/types'

import {
    isLastPage,
    parseChapterDetails,
    parseChapterList,
    parseHomeSections,
    parseMangaDetails,
    parseSearch,
    parseTags,
    parseThumbnailUrl,
    parseViewMore
} from './BatoToParserV4'

import { BTLanguages,
    BTDomains,
    Metadata, 
    BTQueries} from './BatoToHelper'

import { languageSettings,
    domainSettings,
    resetSettings } from './BatoToSettings'

const BATO_DOMAIN_DEFAULT = BTDomains.getDefault()[0] ?? 'https://bato.si'

export const BatoToInfo: SourceInfo = {
    version: '3.1.7',
    name: 'BatoTo DevDomain 1.1',
    // name: 'BatoTo Dev Test 1.5',
    icon: 'icon.png',
    author: 'niclimcy',
    authorWebsite: 'https://github.com/niclimcy',
    description: 'Extension that pulls manga from bato.to',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: BATO_DOMAIN_DEFAULT,
    sourceTags: [
        {
            text: 'Multi Language',
            type: BadgeColor.BLUE
        }
    ],
    intents:
        SourceIntents.MANGA_CHAPTERS |
        SourceIntents.HOMEPAGE_SECTIONS |
        SourceIntents.SETTINGS_UI |
        SourceIntents.CLOUDFLARE_BYPASS_REQUIRED
}

export class BatoTo
implements
        SearchResultsProviding,
        MangaProviding,
        ChapterProviding,
        HomePageSectionsProviding
{
    constructor(private cheerio: CheerioAPI) {}

    stateManager = App.createSourceStateManager();

    requestManager = App.createRequestManager({
        requestsPerSecond: 4,
        requestTimeout: 15000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                const selectedDomain = await this.stateManager.retrieve('selected_domain')
                request.headers = {
                    ...(request.headers ?? {}),
                    ...{
                        referer: `${selectedDomain ?? BATO_DOMAIN_DEFAULT}/`,
                        origin: selectedDomain ?? BATO_DOMAIN_DEFAULT,
                        'user-agent':
                    await this.requestManager.getDefaultUserAgent()
                    }
                }
                return request
            },
            interceptResponse: async (
                response: Response
            ): Promise<Response> => {
                console.log(`[BatoTo] ${response.request.url} - ${response.status}`)
                console.log(`[BatoTo-DATA] ${response.data?.toString()}`)
                return response
            }
        }
    })

    async networkRequestPost(apiQuery: string, apiVariables: any): Promise<Response> {
        const domain = await this.stateManager.retrieve('selected_domain') ?? BATO_DOMAIN_DEFAULT

        try {
            const request = App.createRequest({
                url: `${domain}/ap2/`,
                method: 'POST',
                headers: {
                    'content-type': 'application/json'
                },
                data: { query: apiQuery, variables: apiVariables }
            })
    
            return await this.requestManager.schedule(request, 1)}
        catch (error: any) {
            throw new Error(`POST request failed: ${error?.message || String(error)}`)
        }
    }

    async networkRequestGet(path: string, param = ''): Promise<Response> {
        const domain = await this.stateManager.retrieve('selected_domain') ?? BATO_DOMAIN_DEFAULT

        try {
            const request = App.createRequest({
                url: `${domain}${path}${param}`,
                method: 'GET'
            })
    
            return await this.requestManager.schedule(request, 1)}
        catch (error: any) {
            throw new Error(`GET request failed: ${error?.message || String(error)}`)
        }
    }

    async getSourceMenu(): Promise<DUISection> {
        return Promise.resolve(
            App.createDUISection({
                id: 'main',
                header: 'Source Settings',
                isHidden: false,
                rows: async () => [
                    languageSettings(this.stateManager),
                    domainSettings(this.stateManager),
                    resetSettings(this.stateManager)
                ]
            })
        )
    }

    getMangaShareUrl(mangaId: string): string {
        return `${BATO_DOMAIN_DEFAULT}/title/${mangaId}`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const tmpDomain = await this.stateManager.retrieve('selected_domain')
        const response = await this.networkRequestGet(`/title/${mangaId}`)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(response.data as string)
        return parseMangaDetails($, tmpDomain ?? BATO_DOMAIN_DEFAULT, mangaId)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const response = await this.networkRequestGet(`/title/${mangaId}`)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(response.data as string)
        return parseChapterList($, mangaId)
    }

    async getChapterDetails(
        mangaId: string,
        chapterId: string
    ): Promise<ChapterDetails> {
        const response = await this.networkRequestGet(`/title/${mangaId}/${chapterId}`)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(response.data as string)
        return parseChapterDetails($, mangaId, chapterId)
    }

    async getHomePageSections(
        sectionCallback: (section: HomeSection) => void
    ): Promise<void> {
        const tmpDomain = await this.stateManager.retrieve('selected_domain')
        const response = await this.networkRequestGet('/')
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(response.data as string)
        parseHomeSections($, tmpDomain ?? BATO_DOMAIN_DEFAULT, sectionCallback)
    }

    async getViewMoreItems(
        homepageSectionId: string,
        metadata: Metadata | undefined
    ): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1
        let queryString = ''
        let variable

        switch (homepageSectionId) {
            case 'popular_updates':
                queryString = BTQueries.getQuery('viewMore')
                variable = {
                    select:{
                        where: 'popular', 
                        init: 0, 
                        size: 32, 
                        page: page
                    }
                }
                break
            case 'latest_releases':
                queryString = BTQueries.getQuery('viewMore')
                variable = {
                    select:{
                        where: 'release', 
                        init: 0, 
                        size: 32, 
                        page: page
                    }
                }
                break
            default:
                throw new Error(
                    'Requested to getViewMoreItems for a section ID which doesn\'t exist'
                )
        }

        const langSearchFilter: boolean =
        (await this.stateManager.retrieve('language_search_filter')) ??
        false
        const langs: string[] =
        (await this.stateManager.retrieve('languages')) ??
        BTLanguages.getDefault()

        const response = await this.networkRequestPost(queryString, variable)

        this.CloudFlareError(response.status)
        if (!response.data) {
            return App.createPagedResults({
                results: [],
                metadata: undefined
            })
        }
        const resData = (JSON.parse(response.data)).data
        const tmpDomain = await this.stateManager.retrieve('selected_domain')
        const manga = parseViewMore(resData.get_latestReleases.items, langSearchFilter, langs, tmpDomain ?? BATO_DOMAIN_DEFAULT)

        metadata = resData.get_latestReleases.paging.next != 0 ? { page: page + 1 } : undefined
        return App.createPagedResults({
            results: manga,
            metadata
        })
    }

    async getSearchResults(
        query: SearchRequest,
        metadata: Metadata | undefined
    ): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1

        const langSearchFilter: boolean =
            (await this.stateManager.retrieve('language_search_filter')) ??
            false
        const langs: string[] =
            (await this.stateManager.retrieve('languages')) ??
            BTLanguages.getDefault()

        const queryString = BTQueries.getQuery('search')
        const variable ={
            select:{
                word:query.title ?? '',
                size:32,
                page:page,
                sortby:null
            }
        }

        const response = await this.networkRequestPost(queryString, variable)

        if (!response.data) {
            return App.createPagedResults({
                results: [],
                metadata: undefined
            })
        }
        const resData = JSON.parse(response.data).data
        const tmpDomain = await this.stateManager.retrieve('selected_domain')
        const manga = parseSearch(resData.get_search_comic.items, langSearchFilter, langs, tmpDomain ?? BATO_DOMAIN_DEFAULT)
        

        metadata = resData.get_search_comic.paging.next != 0 ? { page: page + 1 } : undefined
        return App.createPagedResults({
            results: manga,
            metadata
        })
    }

    async getSearchTags(): Promise<TagSection[]> {
        return parseTags()
    }

    // async getThumbnailUrl(mangaId: string): Promise<string> {
    //     const response = await this.networkRequest(`/title/${mangaId}`)
    //     this.CloudFlareError(response.status)
    //     const $ = this.cheerio.load(response.data as string)
    //     return parseThumbnailUrl($)
    // }

    CloudFlareError(status: number): void {
        if (status == 503 || status == 403) {
            throw new Error(
                `CLOUDFLARE BYPASS ERROR:\
Please go to the homepage of <${BatoTo.name}> and press the cloud icon.`
            )
        }
    }

    async getCloudflareBypassRequestAsync(): Promise<Request> {

        const tmpDomain = await this.stateManager.retrieve('selected_domain') ?? BATO_DOMAIN_DEFAULT
        
        const domain = typeof(tmpDomain) === 'string' ? tmpDomain : tmpDomain[0]

        const req =  App.createRequest({
            url: domain ?? BATO_DOMAIN_DEFAULT,
            method: 'GET',
            headers: {
                referer: `${domain}/`,
                'user-agent': await this.requestManager.getDefaultUserAgent()
            }
        })

        console.log(`[BatoTo] Generated Cloudflare bypass request for domain: ${domain}`)
        console.log(`[BatoTo-Request] ${JSON.stringify(req)}`)

        return req
    }
}

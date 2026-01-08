import {
    Chapter,
    ChapterDetails,
    HomeSection,
    HomeSectionType,
    PartialSourceManga,
    SourceManga,
    Tag,
    TagSection
} from '@paperback/types'

import {
    BTGenres,
    BTLanguages
} from './BatoToHelper'

import * as CryptoJS from './external/crypto-js.min' // 4.2.0
import entities = require('entities')

export const parseMangaDetails = ($: CheerioStatic, mangaId: string): SourceManga => {
    const titles: string[] = []

    titles.push(decodeHTMLEntity($('a', $('.item-title')).text().trim() ?? ''))
    const altTitles = $('.alias-set').text().trim().split('/')
    for (const title of altTitles) {
        titles.push(decodeHTMLEntity(title))
    }

    const description = decodeHTMLEntity($('.limit-html').text().trim() ?? '')

    const authorElement = $('div.attr-item b:contains("Authors")').next('span')
    const author = authorElement.length ? authorElement.children().map((_: number, e: CheerioElement) => {
        return $(e).text().trim()
    }).toArray().join(', ') : ''

    const artistElement = $('div.attr-item b:contains("Artists")').next('span')
    const artist = artistElement.length ? artistElement.children().map((_: number, e: CheerioElement) => {
        return $(e).text().trim()
    }).toArray().join(', ') : ''

    const arrayTags: Tag[] = []
    for (const tag of $('div.attr-item b:contains("Genres")').next('span').children().toArray()) {
        const label = $(tag).text().trim()
        const id = encodeURI(BTGenres.getParam(label) ?? label)

        if (!id || !label) continue
        arrayTags.push({ id: id, label: label })
    }
    const tagSections: TagSection[] = [App.createTagSection({ id: '0', label: 'genres', tags: arrayTags.map(x => App.createTag(x)) })]

    const rawStatus = $('div.attr-item b:contains("Upload status")').next('span').text().trim()
    let status = 'ONGOING'
    switch (rawStatus.toUpperCase()) {
        case 'ONGOING':
            status = 'Ongoing'
            break
        case 'COMPLETED':
            status = 'Completed'
            break
        case 'HIATUS':
            status = 'Hiatus'
            break
        default:
            status = 'Ongoing'
            break
    }

    return App.createSourceManga({
        id: mangaId,
        mangaInfo: App.createMangaInfo({
            titles: titles,
            image: `mangaId=${mangaId}`,
            status: status,
            author: author,
            artist: artist,
            tags: tagSections,
            desc: description
        })
    })
}

export const parseChapterList = ($: CheerioStatic, mangaId: string): Chapter[] => {
    const chapters: Chapter[] = []
    let sortingIndex = 0

    for (const chapter of $('[q\\:key="N0_9"]').toArray()) {
        const title = $('a', chapter).first().text().trim()
        const chapterId: string = $('a', chapter).first().attr('href')?.replace(/\/$/, '')?.split('/').pop() ?? ''
        const groupDiv = $('[q\\:key="00_1"]', chapter).first()
        const group: string = $('a', groupDiv).last().text().trim()
        if (!chapterId) continue

        let language = BTLanguages.getLangCode($('em').attr('data-lang') ?? '')
        if (language === 'Unknown') language = '🇬🇧'

        const timeAgo = $('[q\\:key="ey_0"]', chapter).text().trim().split(' ')
        const chapNumRegex = title.match(/(\d+)(?:[-.]\d+)?/)
        let date = new Date(Date.now())

        if (timeAgo[1] == 'secs') date = new Date(Date.now() - 1000 * Number(timeAgo[0]))
        if (timeAgo[1] == 'mins') date = new Date(Date.now() - 1000 * 60 * Number(timeAgo[0]))
        if (timeAgo[1] == 'hours') date = new Date(Date.now() - 1000 * 3600 * Number(timeAgo[0]))
        if (timeAgo[1] == 'days') date = new Date(Date.now() - 1000 * 3600 * 24 * Number(timeAgo[0]))

        let chapNum = (chapNumRegex && chapNumRegex[1]) ? Number(chapNumRegex[1].replace('-', '.')) : 0
        if (isNaN(chapNum)) chapNum = 0

        chapters.push({
            id: chapterId,
            name: title,
            langCode: language,
            chapNum: chapNum,
            time: date,
            sortingIndex,
            volume: 0,
            group: group
        })
        sortingIndex--
    }

    if (chapters.length == 0) {
        throw new Error(`Couldn't find any chapters for mangaId: ${mangaId}!`)
    }

    return chapters.map(chapter => {
        chapter.sortingIndex += chapters.length
        return App.createChapter(chapter)
    })
}

export const parseChapterDetails = ($: CheerioStatic, mangaId: string, chapterId: string): ChapterDetails => {
    // Get all of the pages
    // const scriptObj = $('script').toArray().find((obj: CheerioElement) => {
    //     const data = obj.children[0]?.data ?? ''
    //     return data.includes('batoPass') && data.includes('batoWord')
    // })
    // const script = scriptObj?.children[0]?.data ?? ''

    // const batoPass = eval(script.match(/const\s+batoPass\s*=\s*(.*?);/)?.[1] ?? '').toString()
    // const batoWord = script.match(/const\s+batoWord\s*=\s*"(.*)";/)?.[1] ?? ''
    // const imgHttps = script.match(/const\s+imgHttps\s*=\s*(.*?);/)?.[1] ?? ''

    // const imgList: string[] = JSON.parse(imgHttps).map((img: string) => img.replace('https://k', 'https://n'))
    // const tknList: string[] = JSON.parse(CryptoJS.AES.decrypt(batoWord, batoPass).toString(CryptoJS.enc.Utf8))

    // const pages = imgList.map((value: string, index: number) => `${value}?${tknList[index]}`)

    const pagesDivs = $('[q\\:key="6N_2"]').toArray()

    const pages: string[] = pagesDivs.map((pageDiv: CheerioElement) => {
        const imgUrl = $('img', pageDiv).attr('src') ?? ''
        return imgUrl.replace('https://k', 'https://n')
    })


    const chapterDetails = App.createChapterDetails({
        id: chapterId,
        mangaId: mangaId,
        pages: pages
    })
    return chapterDetails
}

export const parseHomeSections = ($: CheerioStatic, baseURL: string, sectionCallback: (section: HomeSection) => void): void => {
    const popularSection = App.createHomeSection({
        id: 'popular_updates',
        title: 'Popular Updates',
        containsMoreItems: true,
        type: HomeSectionType.singleRowLarge
    })

    const latestSection = App.createHomeSection({
        id: 'latest_releases',
        title: 'Latest Releases',
        containsMoreItems: true,
        type: HomeSectionType.singleRowNormal
    })

    // Popular Updates
    const popularSection_Array: PartialSourceManga[] = []
    for (const manga of $('[q\\:key="85_7"]').toArray()) {
        const image: string = baseURL + $('img', manga).attr('src')
        const title: string = $('img', manga).attr('title')?.trim() ?? ''
        const id = $('a', manga).first().attr('href')?.replace('/title/', '')?.trim().split('/')[0] ?? ''
        const btcode = $('em', manga).attr('data-lang')
        const lang: string = btcode ? BTLanguages.getLangCode(btcode) : '🇬🇧'
        const subtitle: string = lang + ' ' + $('a', ($('div', manga).first())).last().text().trim() ?? lang

        if (!id || !title) continue
        popularSection_Array.push(App.createPartialSourceManga({
            image: image,
            title: decodeHTMLEntity(title),
            mangaId: id,
            subtitle: decodeHTMLEntity(subtitle)
        }))
    }
    popularSection.items = popularSection_Array
    sectionCallback(popularSection)

    // Latest Releases
    const latestSection_Array: PartialSourceManga[] = []
    for (const manga of $('[q\\:key="wP_7"]').toArray()) {
        const mainDiv = $('[q\\:key="Jg_4"]', manga).first()
        const subDiv = $('[q\\:key="w7_8"]', manga).first()
        const image: string = baseURL + ($('img', mainDiv).attr('src'))
        const title: string = $('img', mainDiv).first().attr('title')?.trim() ?? ''
        const id = $('a', mainDiv).attr('href')?.replace('/title/', '')?.trim().split('/')[0] ?? ''
        const btcode = $('em', mainDiv).attr('data-lang')
        const lang: string = btcode ? BTLanguages.getLangCode(btcode) : '🇬🇧'
        const subtitle: string = lang + ' ' + $('a', subDiv).first().text().trim() ?? lang

        if (!id || !title) continue
        latestSection_Array.push(App.createPartialSourceManga({
            image: image,
            title: decodeHTMLEntity(title),
            mangaId: id,
            subtitle: decodeHTMLEntity(subtitle)
        }))
    }
    latestSection.items = latestSection_Array
    sectionCallback(latestSection)
}

export const parseViewMore = ($: CheerioStatic, baseURL: string): PartialSourceManga[] => {
    const manga: PartialSourceManga[] = []
    const collectedIds: string[] = []

    for (const obj of $('[q\\:key="Fc_9"]').toArray()) {
        const subDiv = $('[q\\:key="w7_8"]', obj).first()
        const id = $('a', $('[q\\:key="Jg_4"]', obj)).attr('href')?.replace('/title/', '').trim().split('/')[0] ?? ''
        const image = baseURL +($('img', obj).first().attr('src'))
        const title = $('img', obj).first().attr('title')?.trim() ?? ''
        const btcode = $('em', obj).attr('data-lang')
        const lang: string = btcode ? BTLanguages.getLangCode(btcode) : '🇬🇧'
        const subtitle = lang + ' ' + $('a', subDiv).text().trim()


        if (!id || !title || collectedIds.includes(id)) continue
        manga.push(App.createPartialSourceManga({
            image: image,
            title: decodeHTMLEntity(title),
            mangaId: id,
            subtitle: decodeHTMLEntity(subtitle)
        }))
        collectedIds.push(id)
    }

    return manga
}

export const parseTags = (): TagSection[] => {
    const arrayTags: Tag[] = []
    for (const label of BTGenres.getGenresList()) {
        const id = encodeURI(BTGenres.getParam(label) ?? label)

        if (!id || !label) continue
        arrayTags.push({ id: id, label: label })
    }
    const tagSections: TagSection[] = [App.createTagSection({ id: '0', label: 'genres', tags: arrayTags.map(x => App.createTag(x)) })]
    return tagSections
}

export const parseSearch = ($: CheerioStatic, langFilter: boolean, langs: string[]): PartialSourceManga[] => {
    const mangas: PartialSourceManga[] = []
    for (const obj of $('.item', '#series-list').toArray()) {
        const id = $('.item-cover', obj).attr('href')?.replace('/series/', '')?.trim().split('/')[0] ?? ''
        const title: string = $('.item-title', obj).text() ?? ''
        const btcode = $('em', obj).attr('data-lang') ?? 'en,en_us'
        const lang: string = btcode ? BTLanguages.getLangCode(btcode) : '🇬🇧'
        const subtitle = lang + ' ' + $('.visited', obj).text().trim()
        const image = ($('img', obj).attr('src'))?.replace('https://k', 'https://n') ?? ''

        if (!id || !title) continue
        if (langFilter && !langs.includes(btcode)) continue

        mangas.push(App.createPartialSourceManga({
            image: image,
            title: decodeHTMLEntity(title),
            mangaId: id,
            subtitle: subtitle
        }))
    }
    return mangas
}

export const parseThumbnailUrl = ($: CheerioStatic): string => {
    return $('div.attr-cover img').attr('src') ?? ''
}

export const isLastPage = ($: CheerioStatic): boolean => {
    return $('.page-item').last().hasClass('disabled')
}

const decodeHTMLEntity = (str: string): string => {
    return entities.decodeHTML(str)
}
